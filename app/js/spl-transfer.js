/*
 * Browser-side SPL token transfers (M4 marketplace).
 *
 * Builds a transfer transaction (ATA create-if-missing + transferChecked),
 * has it signed by the connected wallet (SolanaWallet) and sends it to
 * devnet. Used to escrow NFTs when listing and to pay $GROW when buying.
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

  let web3Module = null;

  async function loadWeb3() {
    if (!web3Module) web3Module = await import(WEB3_CDN);
    return web3Module;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function deriveAta(web3, owner, mint) {
    const [ata] = web3.PublicKey.findProgramAddressSync(
      [owner.toBuffer(), new web3.PublicKey(TOKEN_PROGRAM).toBuffer(), mint.toBuffer()],
      new web3.PublicKey(ATA_PROGRAM)
    );
    return ata;
  }

  // "CreateIdempotent" instruction of the Associated Token Account program.
  function createAtaIdempotentIx(web3, payer, ata, owner, mint) {
    return new web3.TransactionInstruction({
      programId: new web3.PublicKey(ATA_PROGRAM),
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: new web3.PublicKey(SYSTEM_PROGRAM), isSigner: false, isWritable: false },
        { pubkey: new web3.PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
      ],
      data: Uint8Array.from([1]),
    });
  }

  // TransferChecked (instruction 12) of the SPL Token program.
  function transferCheckedIx(web3, source, mint, destination, owner, amount, decimals) {
    const data = new Uint8Array(10);
    data[0] = 12;
    let value = BigInt(amount);
    for (let i = 0; i < 8; i += 1) {
      data[1 + i] = Number(value & 0xffn);
      value >>= 8n;
    }
    data[9] = decimals;
    return new web3.TransactionInstruction({
      programId: new web3.PublicKey(TOKEN_PROGRAM),
      keys: [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
      data,
    });
  }

  function isBlockhashExpiredError(err) {
    const msg = String((err && err.message) || err || '');
    return /block height exceeded|blockhash not found|has expired/i.test(msg);
  }

  function isMissingTokenError(err) {
    const msg = String((err && err.message) || err || '');
    return /invalid account data for instruction|insufficient funds|custom program error: 0x1\b/i.test(
      msg
    );
  }

  function friendlyExpiredError() {
    return new Error(
      'Wallet approval took too long and the Solana transaction expired. Approve within about a minute, then try posting again.'
    );
  }

  function friendlyMissingTokenError(params) {
    if (Number(params.decimals || 0) === 0) {
      return new Error(
        'This connected wallet does not hold that Seed NFT. Switch to the wallet that received the mint (or transfer the NFT here), then try again.'
      );
    }
    return new Error(
      'This connected wallet does not have enough of that token for the transfer. Check the balance on Devnet and try again.'
    );
  }

  function friendlyConfirmTimeoutError(signature) {
    return new Error(
      'Transaction was sent but confirmation timed out on the public Devnet RPC. Signature: ' +
        signature +
        '. Refresh and check whether the offer/NFT already moved before trying again.'
    );
  }

  async function readSignatureStatus(connection, signature) {
    for (let i = 0; i < 5; i += 1) {
      try {
        const res = await connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
        return res && res.value && res.value[0];
      } catch {
        await sleep(400 * (i + 1));
      }
    }
    return null;
  }

  /*
   * Avoid Connection.confirmTransaction websockets — public Devnet RPC 429s them
   * and then falsely reports "block height exceeded" for txs that already landed.
   */
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

  function buildTransferTx(web3, owner, mint, toOwner, amount, decimals) {
    const sourceAta = deriveAta(web3, owner, mint);
    const destAta = deriveAta(web3, toOwner, mint);
    const tx = new web3.Transaction();
    tx.add(createAtaIdempotentIx(web3, owner, destAta, toOwner, mint));
    tx.add(transferCheckedIx(web3, sourceAta, mint, destAta, owner, amount, decimals));
    tx.feePayer = owner;
    return tx;
  }

  async function tokenRawBalance(connection, web3, owner, mint) {
    const ata = deriveAta(web3, owner, mint);
    try {
      const bal = await connection.getTokenAccountBalance(ata);
      return BigInt((bal && bal.value && bal.value.amount) || '0');
    } catch {
      return 0n;
    }
  }

  const SplTransfer = {
    // Whole-token UI amount held by the connected wallet for `mint` (0 if none).
    async getBalance(mintAddress) {
      const SW = window.SolanaWallet;
      if (!SW || !SW.isConnected()) return 0;
      const web3 = await loadWeb3();
      const connection = await SW.getConnection();
      const owner = new web3.PublicKey(SW.getPublicKey());
      const mint = new web3.PublicKey(mintAddress);
      const raw = await tokenRawBalance(connection, web3, owner, mint);
      // Best-effort UI amount for 0-decimal NFTs / whole tokens.
      return Number(raw);
    },

    async getRawBalance(mintAddress) {
      const SW = window.SolanaWallet;
      if (!SW || !SW.isConnected()) return 0n;
      const web3 = await loadWeb3();
      const connection = await SW.getConnection();
      const owner = new web3.PublicKey(SW.getPublicKey());
      const mint = new web3.PublicKey(mintAddress);
      return tokenRawBalance(connection, web3, owner, mint);
    },

    // Raw balance of `mint` held by an arbitrary wallet (e.g. escrow).
    async getRawBalanceOf(ownerAddress, mintAddress) {
      const SW = window.SolanaWallet;
      if (!SW) return 0n;
      const web3 = await loadWeb3();
      const connection = await SW.getConnection();
      const owner = new web3.PublicKey(ownerAddress);
      const mint = new web3.PublicKey(mintAddress);
      return tokenRawBalance(connection, web3, owner, mint);
    },

    /*
     * Transfer `amount` base units of `mint` from the connected wallet to
     * `to` (a wallet address; its ATA is created if missing).
     * Returns the confirmed transaction signature.
     */
    async transferToken(params) {
      const SW = window.SolanaWallet;
      if (!SW || !SW.isConnected()) throw new Error('Wallet not connected.');

      const web3 = await loadWeb3();
      const connection = await SW.getConnection();
      const owner = new web3.PublicKey(SW.getPublicKey());
      const mint = new web3.PublicKey(params.mint);
      const toOwner = new web3.PublicKey(params.to);
      const amount = BigInt(params.amount);
      const decimals = Number(params.decimals || 0);

      const held = await tokenRawBalance(connection, web3, owner, mint);
      if (held < amount) throw friendlyMissingTokenError(params);

      let lastErr = null;
      for (let attempt = 1; attempt <= MAX_SIGN_ATTEMPTS; attempt += 1) {
        try {
          // Fresh blockhash immediately before wallet prompt.
          const tx = buildTransferTx(web3, owner, mint, toOwner, amount, decimals);
          const latest = await connection.getLatestBlockhash('confirmed');
          tx.recentBlockhash = latest.blockhash;

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
            // If send fails with expired blockhash before broadcast, resign.
            if (isBlockhashExpiredError(sendErr) && attempt < MAX_SIGN_ATTEMPTS) {
              lastErr = sendErr;
              continue;
            }
            throw sendErr;
          }

          // Once broadcast, never resign/retry a new transfer — the NFT/$GROW
          // may already have moved. Only poll for confirmation.
          return await confirmByPolling(connection, signature);
        } catch (err) {
          lastErr = err;
          // Only resign when we never successfully broadcast.
          if (!isBlockhashExpiredError(err) || attempt === MAX_SIGN_ATTEMPTS) break;
        }
      }

      if (isBlockhashExpiredError(lastErr)) throw friendlyExpiredError();
      if (isMissingTokenError(lastErr)) throw friendlyMissingTokenError(params);
      throw lastErr;
    },

    // Convenience: escrow an NFT (amount 1, decimals 0).
    async transferNft(mint, to) {
      return SplTransfer.transferToken({ mint, to, amount: 1n, decimals: 0 });
    },

    // Convenience: pay whole $GROW tokens.
    async payGrow(to, wholeTokens) {
      const cfg = window.ChainConfig || {};
      if (!cfg.growMint) throw new Error('$GROW mint is not deployed yet.');
      const decimals = Number(cfg.growDecimals || 9);
      return SplTransfer.transferToken({
        mint: cfg.growMint,
        to,
        amount: BigInt(wholeTokens) * 10n ** BigInt(decimals),
        decimals,
      });
    },
  };

  window.SplTransfer = SplTransfer;
})();
