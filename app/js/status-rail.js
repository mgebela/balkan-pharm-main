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
        const label = esc((step && step.label) || 'Step');
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
      '" role="list" aria-label="Process status">' +
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
        { key: 'sign', label: 'Sign buy' },
        { key: 'done', label: 'Confirmed' },
      ];
      if (status === 'failed') {
        return html({
          steps: steps,
          currentIndex: 0,
          tone: 'fail',
          caption: err || 'Buy failed on Devnet.',
        });
      }
      if (status === 'sold') {
        return html({
          steps: steps,
          currentIndex: 2,
          tone: 'ok',
          caption: 'NFT is in your wallet.',
        });
      }
      if (status === 'sale_pending' || hasConfirmedPayment(L)) {
        return html({
          steps: steps,
          currentIndex: 1,
          tone: 'pending',
          caption: 'Confirming on-chain buy…',
        });
      }
      return html({
        steps: steps,
        currentIndex: 0,
        tone: 'pending',
        caption: 'Approve the buy in your wallet.',
      });
    }

    const steps = [
      { key: 'pay', label: 'Pay $GROWTOO' },
      { key: 'settle', label: 'Settling' },
      { key: 'nft', label: 'NFT ready' },
    ];

    if (status === 'failed') {
      const paid = hasConfirmedPayment(L);
      return html({
        steps: steps,
        currentIndex: paid ? 1 : 0,
        tone: 'fail',
        caption: err || 'Investment failed. Check payment and try again.',
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
          caption: 'Payment seen — releasing NFT from escrow…',
        });
      }
      return html({
        steps: steps,
        currentIndex: 0,
        tone: 'pending',
        caption: 'Complete $GROWTOO payment in your wallet.',
      });
    }
    return '';
  }

  /** Grower listing lifecycle: Escrow → Live → Sold/Cancel. */
  function listingPipeline(listing) {
    const L = listing || {};
    const status = String(L.status || '');
    const steps = [
      { key: 'escrow', label: 'Escrow' },
      { key: 'live', label: 'Live' },
      { key: 'end', label: status === 'cancelled' || status === 'cancel_requested' ? 'Cancel' : 'Sold' },
    ];
    const err = String(L.error || L.lastError || '').trim();

    if (status === 'failed') {
      return html({
        steps: steps,
        currentIndex: 0,
        tone: 'fail',
        caption: err || 'Listing failed.',
      });
    }
    if (status === 'escrow_pending') {
      return html({
        steps: steps,
        currentIndex: 0,
        tone: 'pending',
        caption: 'Waiting for NFT in escrow…',
      });
    }
    if (status === 'active') {
      return html({
        steps: steps,
        currentIndex: 1,
        tone: 'ok',
        caption: 'Open for investment.',
      });
    }
    if (status === 'sale_pending') {
      return html({
        steps: [
          { key: 'escrow', label: 'Escrow' },
          { key: 'live', label: 'Live' },
          { key: 'settle', label: 'Settling' },
        ],
        currentIndex: 2,
        tone: 'pending',
        caption: 'Buyer paid — settling NFT…',
      });
    }
    if (status === 'cancel_requested') {
      return html({
        steps: steps,
        currentIndex: 2,
        tone: 'pending',
        caption: 'Returning NFT to grower…',
      });
    }
    if (status === 'sold') {
      return html({
        steps: [
          { key: 'escrow', label: 'Escrow' },
          { key: 'live', label: 'Live' },
          { key: 'end', label: 'Sold' },
        ],
        currentIndex: 3,
        tone: 'ok',
        caption: 'Adopted by buyer.',
      });
    }
    if (status === 'cancelled') {
      return html({
        steps: steps,
        currentIndex: 3,
        tone: 'ok',
        caption: 'Offer cancelled.',
      });
    }
    return '';
  }

  /** Seed mint queue: Queued → Minting → Minted (or fail). */
  function mintPipeline(mintRecord, opts) {
    const o = opts || {};
    const mint = mintRecord || null;
    const steps = [
      { key: 'queued', label: 'Queued' },
      { key: 'minting', label: 'Minting' },
      { key: 'minted', label: 'Minted' },
    ];
    if (!mint) {
      return html({
        steps: steps,
        currentIndex: 0,
        tone: 'pending',
        caption: o.caption || 'Devnet mint requested…',
      });
    }
    const st = String(mint.status || 'pending');
    if (st === 'failed') {
      return html({
        steps: steps,
        currentIndex: 1,
        tone: 'fail',
        caption: (mint.error && String(mint.error).slice(0, 160)) || 'Devnet mint failed.',
      });
    }
    if (st === 'minted' && mint.mintAddress) {
      return html({
        steps: steps,
        currentIndex: 3,
        tone: 'ok',
        caption: o.caption || 'Minted on Devnet.',
      });
    }
    // pending / processing
    return html({
      steps: steps,
      currentIndex: st === 'pending' && !mint.signature ? 0 : 1,
      tone: 'pending',
      caption: o.caption || 'Mint queue working on Devnet…',
    });
  }

  window.StatusRail = {
    html: html,
    investPipeline: investPipeline,
    listingPipeline: listingPipeline,
    mintPipeline: mintPipeline,
    hasConfirmedPayment: hasConfirmedPayment,
  };
})();
