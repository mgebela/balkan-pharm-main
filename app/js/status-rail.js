/*
 * Shared semaphore / phase rail for market invest + mint queues.
 * Usage: StatusRail.html({ steps, currentIndex, tone, caption })
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * @param {{
   *   steps: Array<{ key?: string, label: string }>,
   *   currentIndex?: number,
   *   tone?: 'ok' | 'pending' | 'fail',
   *   caption?: string
   * }} opts
   * currentIndex: 0-based active step; -1 = all idle; >= length = all done
   */
  function html(opts) {
    const o = opts || {};
    const steps = Array.isArray(o.steps) ? o.steps : [];
    if (!steps.length) return '';
    const n = steps.length;
    let current = Number(o.currentIndex);
    if (!Number.isFinite(current)) current = 0;
    const tone = o.tone === 'fail' || o.tone === 'ok' ? o.tone : 'pending';
    const allDone = current >= n && tone !== 'fail';
    const failAt = tone === 'fail' ? Math.max(0, Math.min(n - 1, current < 0 ? n - 1 : current)) : -1;

    const items = steps
      .map(function (step, i) {
        const label = esc((step && step.label) || T('app.statusRail.step', 'Step'));
        let cls = 'status-rail-step';
        if (tone === 'fail' && i === failAt) {
          cls += ' status-rail-step--fail';
        } else if (allDone || i < current) {
          cls += ' status-rail-step--done';
        } else if (i === current && tone !== 'fail') {
          cls += ' status-rail-step--current';
        } else {
          cls += ' status-rail-step--idle';
        }
        return (
          '<li class="' +
          cls +
          '"' +
          (step && step.key ? ' data-step="' + esc(step.key) + '"' : '') +
          '>' +
          '<span class="status-rail-dot" aria-hidden="true"></span>' +
          '<span class="status-rail-label">' +
          label +
          '</span>' +
          '</li>'
        );
      })
      .join('');

    const caption = o.caption
      ? '<p class="status-rail-caption">' + esc(o.caption) + '</p>'
      : '';

    return (
      '<div class="status-rail status-rail--' +
      tone +
      // i18n-ignore — markup, the label itself is translated below.
      '" role="list" aria-label="' +
      esc(T('app.statusRail.ariaLabel', 'Process status')) +
      '">' +
      '<ol class="status-rail-track">' +
      items +
      '</ol>' +
      caption +
      '</div>'
    );
  }

  function hasConfirmedPayment(listing) {
    const sig = String(
      (listing && (listing.paymentSignature || listing.buySignature)) || ''
    );
    if (!sig || sig.indexOf('pending-') === 0) return false;
    return sig.length >= 32;
  }

  /** Adopter invest: Pay → Settling → NFT ready (or Sign buy → Confirmed for program). */
  function investPipeline(listingOrToken) {
    const L = listingOrToken || {};
    const status = String(L.status || L.investStatus || '');
    const settlement = String(L.settlement || '');
    const err = String(L.error || L.lastError || '').trim();

    if (settlement === 'program') {
      const steps = [
        { key: 'sign', label: T('app.statusRail.signBuy', 'Sign buy') },
        { key: 'done', label: T('app.statusRail.confirmed', 'Confirmed') },
      ];
      if (status === 'failed') {
        return html({
          steps: steps,
          currentIndex: 0,
          tone: 'fail',
          caption: err || T('app.statusRail.buyFailedOnDevnet', 'Buy failed on Devnet.'),
        });
      }
      if (status === 'sold') {
        return html({
          steps: steps,
          currentIndex: 2,
          tone: 'ok',
          caption: T('app.statusRail.nftIsInYour', 'NFT is in your wallet.'),
        });
      }
      if (status === 'sale_pending' || hasConfirmedPayment(L)) {
        return html({
          steps: steps,
          currentIndex: 1,
          tone: 'pending',
          caption: T('app.statusRail.confirmingOnChainBuy', 'Confirming on-chain buy…'),
        });
      }
      return html({
        steps: steps,
        currentIndex: 0,
        tone: 'pending',
        caption: T('app.statusRail.approveTheBuyIn', 'Approve the buy in your wallet.'),
      });
    }

    const steps = [
      { key: 'pay', label: T('app.statusRail.payGrowtoo', 'Pay $GROWTOO') },
      { key: 'settle', label: T('app.statusRail.settling', 'Settling') },
      { key: 'nft', label: T('app.statusRail.nftReady', 'NFT ready') },
    ];

    if (status === 'failed') {
      const paid = hasConfirmedPayment(L);
      return html({
        steps: steps,
        currentIndex: paid ? 1 : 0,
        tone: 'fail',
        caption: err || T('app.statusRail.investmentFailedCheckPayment', 'Investment failed. Check payment and try again.'),
      });
    }
    if (status === 'sold') {
      return html({
        steps: steps,
        currentIndex: 3,
        tone: 'ok',
        caption: L.settlement === 'adopt_stake' ? 'Stake active — NFT adopted.' : 'NFT is in your wallet.',
      });
    }
    if (status === 'sale_pending') {
      if (hasConfirmedPayment(L)) {
        return html({
          steps: steps,
          currentIndex: 1,
          tone: 'pending',
          caption:
            settlement === 'adopt_stake'
              ? T('app.statusRail.paymentSeenStake', 'Payment seen — settling 50% to grower, locking 50%…')
              : T('app.statusRail.paymentSeenSale', 'Payment seen — releasing NFT from escrow…'),
        });
      }
      return html({
        steps: steps,
        currentIndex: 0,
        tone: 'pending',
        caption: T('app.statusRail.completeGrowtooPaymentIn', 'Complete $GROWTOO payment in your wallet.'),
      });
    }
    return '';
  }

  /**
   * Harvest locked-stake claim: Claimed → Queue → Released/Refunded.
   * Accepts { claim, listing } or a flat claim/listing-shaped object.
   */
  function harvestClaimPipeline(input) {
    const src = input || {};
    const claim = src.claim || (src.status && src.listingId ? src : null);
    const listing = src.listing || src;
    const claimStatus = String((claim && claim.status) || src.claimStatus || '').toLowerCase();
    const careStatus = String(
      (listing && listing.careStatus) || src.careStatus || ''
    ).toLowerCase();
    const err = String(
      (claim && (claim.error || claim.lastError)) || src.error || ''
    ).trim();

    const settled =
      careStatus === 'released' ||
      careStatus === 'refunded' ||
      claimStatus === 'released' ||
      claimStatus === 'refunded';
    /* Decide on the state, not on the words: endLabel is display copy and
       changes with the language, so the branch below tests the flag. */
    const refunded = careStatus === 'refunded' || claimStatus === 'refunded';
    const endLabel = refunded
      ? T('app.statusRail.refunded', 'Refunded')
      : T('app.statusRail.released', 'Released');
    const steps = [
      { key: 'filed', label: T('app.statusRail.claimed', 'Claimed') },
      { key: 'queue', label: T('app.statusRail.queue', 'Queue') },
      { key: 'done', label: endLabel },
    ];

    if (claimStatus === 'failed') {
      return html({
        steps: steps,
        currentIndex: 1,
        tone: 'fail',
        caption: err || T('app.statusRail.claimFailedCheckCare', 'Claim failed — check care months and retry.'),
      });
    }
    if (settled) {
      return html({
        steps: steps,
        currentIndex: 3,
        tone: 'ok',
        caption: refunded
          ? T('app.statusRail.lockedReturned', 'Locked $GROWTOO returned to the adopter.')
          : T('app.statusRail.lockedReleased', 'Locked $GROWTOO released to the grower.'),
      });
    }
    if (claimStatus === 'pending' || src.optimisticPending) {
      return html({
        steps: steps,
        currentIndex: 1,
        tone: 'pending',
        caption: T('app.statusRail.queuedAdoptWorkerValidates', 'Queued — adopt worker validates care months next pass (~5 min).'),
      });
    }
    return '';
  }

  /** Grower listing lifecycle: Escrow → Live → Sold/Cancel. */
  function listingPipeline(listing) {
    const L = listing || {};
    const status = String(L.status || '');
    const steps = [
      { key: 'escrow', label: T('app.statusRail.escrow', 'Escrow') },
      { key: 'live', label: T('app.statusRail.live', 'Live') },
      { key: 'end', label: status === 'cancelled' || status === 'cancel_requested' ? 'Cancel' : 'Sold' },
    ];
    const err = String(L.error || L.lastError || '').trim();

    if (status === 'failed') {
      return html({
        steps: steps,
        currentIndex: 0,
        tone: 'fail',
        caption: err || T('app.statusRail.listingFailed', 'Listing failed.'),
      });
    }
    if (status === 'escrow_pending') {
      return html({
        steps: steps,
        currentIndex: 0,
        tone: 'pending',
        caption: T('app.statusRail.waitingForNftIn', 'Waiting for NFT in escrow…'),
      });
    }
    if (status === 'active') {
      return html({
        steps: steps,
        currentIndex: 1,
        tone: 'ok',
        caption: T('app.statusRail.openForInvestment', 'Open for investment.'),
      });
    }
    if (status === 'sale_pending') {
      return html({
        steps: [
          { key: 'escrow', label: T('app.statusRail.escrow', 'Escrow') },
          { key: 'live', label: T('app.statusRail.live', 'Live') },
          { key: 'settle', label: T('app.statusRail.settling', 'Settling') },
        ],
        currentIndex: 2,
        tone: 'pending',
        caption: T('app.statusRail.buyerPaidSettlingNft', 'Buyer paid — settling NFT…'),
      });
    }
    if (status === 'cancel_requested') {
      return html({
        steps: steps,
        currentIndex: 2,
        tone: 'pending',
        caption: T('app.statusRail.returningNftToGrower', 'Returning NFT to grower…'),
      });
    }
    if (status === 'sold') {
      return html({
        steps: [
          { key: 'escrow', label: T('app.statusRail.escrow', 'Escrow') },
          { key: 'live', label: T('app.statusRail.live', 'Live') },
          { key: 'end', label: T('app.statusRail.sold', 'Sold') },
        ],
        currentIndex: 3,
        tone: 'ok',
        caption: T('app.statusRail.adoptedByBuyer', 'Adopted by buyer.'),
      });
    }
    if (status === 'cancelled') {
      return html({
        steps: steps,
        currentIndex: 3,
        tone: 'ok',
        caption: T('app.statusRail.offerCancelled', 'Offer cancelled.'),
      });
    }
    return '';
  }

  /** Seed mint queue: Queued → Minting → Minted (or fail). */
  function mintPipeline(mintRecord, opts) {
    const o = opts || {};
    const mint = mintRecord || null;
    const steps = [
      { key: 'queued', label: T('app.statusRail.queued', 'Queued') },
      { key: 'minting', label: T('app.statusRail.minting', 'Minting') },
      { key: 'minted', label: T('app.statusRail.minted', 'Minted') },
    ];
    if (!mint) {
      return html({
        steps: steps,
        currentIndex: 0,
        tone: 'pending',
        caption: o.caption || T('app.statusRail.mintRequested', 'Devnet mint requested…'),
      });
    }
    const st = String(mint.status || 'pending');
    if (st === 'failed') {
      return html({
        steps: steps,
        currentIndex: 1,
        tone: 'fail',
        caption:
          (mint.error && String(mint.error).slice(0, 160)) ||
          T('app.statusRail.mintFailed', 'Devnet mint failed.'),
      });
    }
    if (st === 'minted' && mint.mintAddress) {
      return html({
        steps: steps,
        currentIndex: 3,
        tone: 'ok',
        caption: o.caption || T('app.statusRail.mintDone', 'Minted on Devnet.'),
      });
    }
    // pending / processing
    return html({
      steps: steps,
      currentIndex: st === 'pending' && !mint.signature ? 0 : 1,
      tone: 'pending',
      caption: o.caption || T('app.statusRail.mintQueueWorking', 'Mint queue working on Devnet…'),
    });
  }

  window.StatusRail = {
    html: html,
    investPipeline: investPipeline,
    listingPipeline: listingPipeline,
    harvestClaimPipeline: harvestClaimPipeline,
    mintPipeline: mintPipeline,
    hasConfirmedPayment: hasConfirmedPayment,
  };
})();
