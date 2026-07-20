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
  const MAX_ATTEMPTS = 3;

  let web3Module = null;

  async function loadWeb3() {
    if (!web3Module) web3Module = await import(WEB3_CDN);
    return web3Module;
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

  async function signatureLanded(connection, signature) {
    if (!signature) return false;
    try {
      const res = await connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      });
      const status = res && res.value && res.value[0];
      if (!status || status.err) return false;
      const conf = status.confirmationStatus;
      return conf === 'confirmed' || conf === 'finalized' || status.confirmations != null;
    } catch {
      return false;
    }
  }

  async function confirmOrRecover(connection, signature, blockhash, lastValidBlockHeight) {
    try {
      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed'
      );
      return signature;
    } catch (err) {
      // Public RPC / slow confirm can throw "block height exceeded" even when
      // the tx already landed. Treat an on-chain success as done.
      if (await signatureLanded(connection, signature)) return signature;
      throw err;
    }
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

  const SplTransfer = {
    // Whole-token UI amount held by the connected wallet for `mint` (0 if none).
    async getBalance(mintAddress) {
      const SW = window.SolanaWallet;
      if (!SW || !SW.isConnected()) return 0;
      const web3 = await loadWeb3();
      const connection = await SW.getConnection();
      const owner = new web3.PublicKey(SW.getPublicKey());
      const mint = new web3.PublicKey(mintAddress);
      const ata = deriveAta(web3, owner, mint);
      try {
        const bal = await connection.getTokenAccountBalance(ata);
        return Number((bal && bal.value && bal.value.uiAmount) || 0);
      } catch {
        return 0;
      }
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
      const amount = params.amount;
      const decimals = Number(params.decimals || 0);

      const sourceAta = deriveAta(web3, owner, mint);
      try {
        const bal = await connection.getTokenAccountBalance(sourceAta);
        const raw = BigInt((bal && bal.value && bal.value.amount) || '0');
        if (raw < BigInt(amount)) throw friendlyMissingTokenError(params);
      } catch (err) {
        if (err && err.message && /does not hold|does not have enough/i.test(err.message)) throw err;
        throw friendlyMissingTokenError(params);
      }

      let lastErr = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          // Fresh blockhash immediately before wallet prompt — slow approval
          // still expires, but we retry with a new prompt instead of failing once.
          const tx = buildTransferTx(web3, owner, mint, toOwner, amount, decimals);
          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(
            'confirmed'
          );
          tx.recentBlockhash = blockhash;

          const signed = await SW.signTransaction(tx);
          const raw = typeof signed.serialize === 'function' ? signed.serialize() : signed;
          const signature = await connection.sendRawTransaction(raw, {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
            maxRetries: 5,
          });
          return await confirmOrRecover(connection, signature, blockhash, lastValidBlockHeight);
        } catch (err) {
          lastErr = err;
          if (!isBlockhashExpiredError(err) || attempt === MAX_ATTEMPTS) break;
          // Ask the wallet to sign again with a fresh blockhash.
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
