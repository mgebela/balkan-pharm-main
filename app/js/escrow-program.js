/*
 * On-chain Anchor escrow client for Growtoo marketplace (Devnet MVP).
 *
 * Builds list / buy / cancel instructions against growtoo_escrow and has the
 * connected wallet sign + send them. Used when ChainConfig.settlementMode === 'program'.
 */
(function () {
  'use strict';

  const WEB3_CDN = 'https://esm.sh/@solana/web3.js@1.98.4';
  const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  const SYSTEM_PROGRAM = '11111111111111111111111111111111';
  const MAX_SIGN_ATTEMPTS = 3;
  const CONFIRM_POLLS = 40;
  const CONFIRM_POLL_MS = 1500;

  // Anchor instruction discriminators (sha256("global:<name>")[0..8])
  const IX = {
    list: [54, 174, 193, 67, 17, 41, 132, 38],
    buy: [102, 6, 61, 18, 1, 218, 235, 234],
    cancel: [232, 219, 223, 41, 219, 236, 220, 190],
  };

  let web3Module = null;

  function cfg() {
    return window.ChainConfig || {};
  }

  function programId(web3) {
    const id = cfg().escrowProgramId;
    if (!id) throw new Error('Escrow program id is not configured.');
    return new web3.PublicKey(id);
  }

  async function loadWeb3() {
    if (!web3Module) web3Module = await import(WEB3_CDN);
    return web3Module;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function encodeU64Le(value) {
    const data = new Uint8Array(8);
    let n = BigInt(value);
    for (let i = 0; i < 8; i += 1) {
      data[i] = Number(n & 0xffn);
      n >>= 8n;
    }
    return data;
  }

  function deriveAta(web3, owner, mint) {
    const [ata] = web3.PublicKey.findProgramAddressSync(
      [owner.toBuffer(), new web3.PublicKey(TOKEN_PROGRAM).toBuffer(), mint.toBuffer()],
      new web3.PublicKey(ATA_PROGRAM)
    );
    return ata;
  }

  function seedBytes(s) {
    return new TextEncoder().encode(s);
  }

  function deriveMarketplace(web3, program) {
    const [pda] = web3.PublicKey.findProgramAddressSync([seedBytes('marketplace')], program);
    return pda;
  }

  function deriveListing(web3, program, mint) {
    const [pda] = web3.PublicKey.findProgramAddressSync(
      [seedBytes('listing'), mint.toBuffer()],
      program
    );
    return pda;
  }

  function isBlockhashExpiredError(err) {
    const msg = String((err && err.message) || err || '');
    return /block height exceeded|blockhash not found|has expired/i.test(msg);
  }

  function friendlyExpiredError() {
    return new Error(
      'Wallet approval took too long and the Solana transaction expired. Approve within about a minute, then try again.'
    );
  }

  function friendlyConfirmTimeoutError(signature) {
    const err = new Error(
      'Transaction was sent but confirmation timed out on the public Devnet RPC. Signature: ' +
        signature +
        '. Refresh and check whether the NFT / listing already moved before trying again.'
    );
    err.signature = signature;
    return err;
  }

  async function readSignatureStatus(connection, signature) {
    for (let i = 0; i < 5; i += 1) {
      try {
        const res = await connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
        return res && res.value && res.value[0];
      } catch (err) {
        const msg = String((err && err.message) || err || '');
        if (/429|Too Many Requests|503|fetch/i.test(msg) && window.SolanaWallet) {
          try {
            connection = await window.SolanaWallet.getConnection({ rotate: true });
          } catch {
            // keep going
          }
        }
        await sleep(400 * (i + 1));
      }
    }
    return null;
  }

  async function confirmByPolling(connection, signature) {
    for (let i = 0; i < CONFIRM_POLLS; i += 1) {
      const status = await readSignatureStatus(connection, signature);
      if (status) {
        if (status.err) {
          throw new Error('Transaction failed on-chain: ' + JSON.stringify(status.err));
        }
        const conf = status.confirmationStatus;
        if (conf === 'confirmed' || conf === 'finalized' || status.confirmations != null) {
          return signature;
        }
      }
      await sleep(CONFIRM_POLL_MS);
    }
    const last = await readSignatureStatus(connection, signature);
    if (last && !last.err) {
      const conf = last.confirmationStatus;
      if (conf === 'confirmed' || conf === 'finalized' || last.confirmations != null) {
        return signature;
      }
    }
    throw friendlyConfirmTimeoutError(signature);
  }

  async function sendSignedTx(buildTx) {
    const SW = window.SolanaWallet;
    if (!SW || !SW.isConnected()) throw new Error('Wallet not connected.');

    const web3 = await loadWeb3();
    const connection = await SW.getConnection();

    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_SIGN_ATTEMPTS; attempt += 1) {
      try {
        const tx = await buildTx(web3, connection);
        const latest = await connection.getLatestBlockhash('confirmed');
        tx.recentBlockhash = latest.blockhash;
        tx.feePayer = new web3.PublicKey(SW.getPublicKey());

        const signed = await SW.signTransaction(tx);
        const raw = typeof signed.serialize === 'function' ? signed.serialize() : signed;

        let signature;
        try {
          signature = await connection.sendRawTransaction(raw, {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
            maxRetries: 5,
          });
        } catch (sendErr) {
          if (isBlockhashExpiredError(sendErr) && attempt < MAX_SIGN_ATTEMPTS) {
            lastErr = sendErr;
            continue;
          }
          throw sendErr;
        }

        return await confirmByPolling(connection, signature);
      } catch (err) {
        lastErr = err;
        if (!isBlockhashExpiredError(err) || attempt === MAX_SIGN_ATTEMPTS) break;
      }
    }

    if (isBlockhashExpiredError(lastErr)) throw friendlyExpiredError();
    throw lastErr;
  }

  function listIx(web3, seller, mint, priceWhole) {
    const program = programId(web3);
    const marketplace = deriveMarketplace(web3, program);
    const listing = deriveListing(web3, program, mint);
    const sellerNft = deriveAta(web3, seller, mint);
    const nftVault = deriveAta(web3, listing, mint);

    const data = new Uint8Array(8 + 8);
    data.set(IX.list, 0);
    data.set(encodeU64Le(priceWhole), 8);

    return {
      ix: new web3.TransactionInstruction({
        programId: program,
        keys: [
          { pubkey: seller, isSigner: true, isWritable: true },
          { pubkey: marketplace, isSigner: false, isWritable: false },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: sellerNft, isSigner: false, isWritable: true },
          { pubkey: listing, isSigner: false, isWritable: true },
          { pubkey: nftVault, isSigner: false, isWritable: true },
          { pubkey: new web3.PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
          { pubkey: new web3.PublicKey(ATA_PROGRAM), isSigner: false, isWritable: false },
          { pubkey: new web3.PublicKey(SYSTEM_PROGRAM), isSigner: false, isWritable: false },
        ],
        data,
      }),
      listingPda: listing.toBase58(),
      nftVault: nftVault.toBase58(),
    };
  }

  function buyIx(web3, buyer, seller, mint) {
    const program = programId(web3);
    const growMint = new web3.PublicKey(cfg().growMint);
    const marketplace = deriveMarketplace(web3, program);
    const listing = deriveListing(web3, program, mint);
    const nftVault = deriveAta(web3, listing, mint);
    const buyerNft = deriveAta(web3, buyer, mint);
    const buyerGrow = deriveAta(web3, buyer, growMint);
    const sellerGrow = deriveAta(web3, seller, growMint);

    return new web3.TransactionInstruction({
      programId: program,
      keys: [
        { pubkey: buyer, isSigner: true, isWritable: true },
        { pubkey: seller, isSigner: false, isWritable: true },
        { pubkey: marketplace, isSigner: false, isWritable: false },
        { pubkey: listing, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: nftVault, isSigner: false, isWritable: true },
        { pubkey: buyerNft, isSigner: false, isWritable: true },
        { pubkey: growMint, isSigner: false, isWritable: false },
        { pubkey: buyerGrow, isSigner: false, isWritable: true },
        { pubkey: sellerGrow, isSigner: false, isWritable: true },
        { pubkey: new web3.PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
        { pubkey: new web3.PublicKey(ATA_PROGRAM), isSigner: false, isWritable: false },
        { pubkey: new web3.PublicKey(SYSTEM_PROGRAM), isSigner: false, isWritable: false },
      ],
      data: Uint8Array.from(IX.buy),
    });
  }

  function cancelIx(web3, seller, mint) {
    const program = programId(web3);
    const marketplace = deriveMarketplace(web3, program);
    const listing = deriveListing(web3, program, mint);
    const nftVault = deriveAta(web3, listing, mint);
    const sellerNft = deriveAta(web3, seller, mint);

    return new web3.TransactionInstruction({
      programId: program,
      keys: [
        { pubkey: seller, isSigner: true, isWritable: true },
        { pubkey: marketplace, isSigner: false, isWritable: false },
        { pubkey: listing, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: nftVault, isSigner: false, isWritable: true },
        { pubkey: sellerNft, isSigner: false, isWritable: true },
        { pubkey: new web3.PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
        { pubkey: new web3.PublicKey(ATA_PROGRAM), isSigner: false, isWritable: false },
        { pubkey: new web3.PublicKey(SYSTEM_PROGRAM), isSigner: false, isWritable: false },
      ],
      data: Uint8Array.from(IX.cancel),
    });
  }

  const EscrowProgram = {
    deriveListingPda: async function (mintAddress) {
      const web3 = await loadWeb3();
      const mint = new web3.PublicKey(mintAddress);
      return deriveListing(web3, programId(web3), mint).toBase58();
    },

    async listNft(mintAddress, priceWhole) {
      const SW = window.SolanaWallet;
      if (!SW || !SW.isConnected()) throw new Error('Wallet not connected.');
      const web3 = await loadWeb3();
      const seller = new web3.PublicKey(SW.getPublicKey());
      const mint = new web3.PublicKey(mintAddress);
      const built = listIx(web3, seller, mint, Math.round(Number(priceWhole)));

      const signature = await sendSignedTx(async function (w) {
        const tx = new w.Transaction();
        tx.add(listIx(w, seller, mint, Math.round(Number(priceWhole))).ix);
        return tx;
      });

      return {
        signature,
        listingPda: built.listingPda,
        nftVault: built.nftVault,
      };
    },

    async buyListing(listing) {
      const SW = window.SolanaWallet;
      if (!SW || !SW.isConnected()) throw new Error('Wallet not connected.');
      if (!listing || !listing.mintAddress || !listing.sellerPubkey) {
        throw new Error('Listing is missing mint or seller pubkey.');
      }
      const web3 = await loadWeb3();
      const buyer = new web3.PublicKey(SW.getPublicKey());
      const seller = new web3.PublicKey(listing.sellerPubkey);
      const mint = new web3.PublicKey(listing.mintAddress);

      return sendSignedTx(async function (w) {
        const tx = new w.Transaction();
        tx.add(buyIx(w, buyer, seller, mint));
        return tx;
      });
    },

    async cancelListing(listing) {
      const SW = window.SolanaWallet;
      if (!SW || !SW.isConnected()) throw new Error('Wallet not connected.');
      if (!listing || !listing.mintAddress) {
        throw new Error('Listing is missing mint address.');
      }
      const web3 = await loadWeb3();
      const seller = new web3.PublicKey(SW.getPublicKey());
      const mint = new web3.PublicKey(listing.mintAddress);

      return sendSignedTx(async function (w) {
        const tx = new w.Transaction();
        tx.add(cancelIx(w, seller, mint));
        return tx;
      });
    },
  };

  window.EscrowProgram = EscrowProgram;
})();
