use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

declare_id!("GspPo6doBKoYmD6aCFHgo2q3CEXmWEoZXPpXAJnkjdyb");

/// Per-listing NFT escrow for Growtoo RWA marketplace (Devnet MVP).
#[program]
pub mod growtoo_escrow {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, fee_bps: u16) -> Result<()> {
        require!(fee_bps <= 1_000, EscrowError::FeeTooHigh);
        let market = &mut ctx.accounts.marketplace;
        market.admin = ctx.accounts.admin.key();
        market.grow_mint = ctx.accounts.grow_mint.key();
        market.fee_bps = fee_bps;
        market.bump = ctx.bumps.marketplace;
        Ok(())
    }

    /// Seller locks 1 NFT into a PDA-owned vault and opens an active listing.
    pub fn list(ctx: Context<List>, price_whole: u64) -> Result<()> {
        require!(price_whole > 0, EscrowError::InvalidPrice);
        require!(ctx.accounts.nft_mint.decimals == 0, EscrowError::NotNft);
        require!(ctx.accounts.seller_nft.amount == 1, EscrowError::MissingNft);

        let listing = &mut ctx.accounts.listing;
        listing.seller = ctx.accounts.seller.key();
        listing.mint = ctx.accounts.nft_mint.key();
        listing.price_whole = price_whole;
        listing.bump = ctx.bumps.listing;
        listing.status = ListingStatus::Active;

        // Seller → vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.seller_nft.to_account_info(),
                    to: ctx.accounts.nft_vault.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            1,
        )?;

        Ok(())
    }

    /// Buyer pays $GROWTOO to seller and receives the NFT atomically.
    pub fn buy(ctx: Context<Buy>) -> Result<()> {
        let listing = &ctx.accounts.listing;
        require!(
            listing.status == ListingStatus::Active,
            EscrowError::ListingNotActive
        );
        require_keys_eq!(
            listing.seller,
            ctx.accounts.seller.key(),
            EscrowError::SellerMismatch
        );
        require_keys_eq!(
            listing.mint,
            ctx.accounts.nft_mint.key(),
            EscrowError::MintMismatch
        );
        require!(
            ctx.accounts.buyer.key() != listing.seller,
            EscrowError::BuyerIsSeller
        );

        let decimals = ctx.accounts.grow_mint.decimals as u32;
        let price_raw = (listing.price_whole as u128)
            .checked_mul(10u128.pow(decimals))
            .ok_or(EscrowError::MathOverflow)? as u64;

        // Buyer → seller $GROWTOO
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_grow.to_account_info(),
                    to: ctx.accounts.seller_grow.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            price_raw,
        )?;

        // Vault → buyer NFT (PDA signer)
        let mint_key = ctx.accounts.nft_mint.key();
        let seeds: &[&[u8]] = &[b"listing", mint_key.as_ref(), &[listing.bump]];
        let signer = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.nft_vault.to_account_info(),
                    to: ctx.accounts.buyer_nft.to_account_info(),
                    authority: ctx.accounts.listing.to_account_info(),
                },
                signer,
            ),
            1,
        )?;

        // Close empty vault ATA; reclaim rent to seller
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.nft_vault.to_account_info(),
                destination: ctx.accounts.seller.to_account_info(),
                authority: ctx.accounts.listing.to_account_info(),
            },
            signer,
        ))?;

        let listing = &mut ctx.accounts.listing;
        listing.status = ListingStatus::Sold;
        Ok(())
    }

    /// Seller cancels an active listing and reclaims the NFT.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let listing = &ctx.accounts.listing;
        require!(
            listing.status == ListingStatus::Active,
            EscrowError::ListingNotActive
        );
        require_keys_eq!(
            listing.seller,
            ctx.accounts.seller.key(),
            EscrowError::SellerMismatch
        );

        let mint_key = ctx.accounts.nft_mint.key();
        let seeds: &[&[u8]] = &[b"listing", mint_key.as_ref(), &[listing.bump]];
        let signer = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.nft_vault.to_account_info(),
                    to: ctx.accounts.seller_nft.to_account_info(),
                    authority: ctx.accounts.listing.to_account_info(),
                },
                signer,
            ),
            1,
        )?;

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.nft_vault.to_account_info(),
                destination: ctx.accounts.seller.to_account_info(),
                authority: ctx.accounts.listing.to_account_info(),
            },
            signer,
        ))?;

        let listing = &mut ctx.accounts.listing;
        listing.status = ListingStatus::Cancelled;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ListingStatus {
    Active,
    Sold,
    Cancelled,
}

#[account]
pub struct Marketplace {
    pub admin: Pubkey,
    pub grow_mint: Pubkey,
    pub fee_bps: u16,
    pub bump: u8,
}

impl Marketplace {
    pub const LEN: usize = 8 + 32 + 32 + 2 + 1;
}

#[account]
pub struct Listing {
    pub seller: Pubkey,
    pub mint: Pubkey,
    pub price_whole: u64,
    pub bump: u8,
    pub status: ListingStatus,
}

impl Listing {
    // discriminator + seller + mint + price + bump + status (+ pad)
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1 + 1 + 2;
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub grow_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = admin,
        space = Marketplace::LEN,
        seeds = [b"marketplace"],
        bump
    )]
    pub marketplace: Account<'info, Marketplace>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(price_whole: u64)]
pub struct List<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        seeds = [b"marketplace"],
        bump = marketplace.bump
    )]
    pub marketplace: Account<'info, Marketplace>,

    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = seller_nft.mint == nft_mint.key(),
        constraint = seller_nft.owner == seller.key(),
    )]
    pub seller_nft: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = seller,
        space = Listing::LEN,
        seeds = [b"listing", nft_mint.key().as_ref()],
        bump
    )]
    pub listing: Account<'info, Listing>,

    #[account(
        init,
        payer = seller,
        associated_token::mint = nft_mint,
        associated_token::authority = listing,
    )]
    pub nft_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: validated against listing.seller
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,

    #[account(
        seeds = [b"marketplace"],
        bump = marketplace.bump,
        constraint = marketplace.grow_mint == grow_mint.key()
    )]
    pub marketplace: Account<'info, Marketplace>,

    #[account(
        mut,
        seeds = [b"listing", nft_mint.key().as_ref()],
        bump = listing.bump,
        close = seller
    )]
    pub listing: Account<'info, Listing>,

    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = nft_mint,
        associated_token::authority = listing,
    )]
    pub nft_vault: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = nft_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_nft: Account<'info, TokenAccount>,

    #[account(constraint = grow_mint.key() == marketplace.grow_mint)]
    pub grow_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = buyer_grow.mint == grow_mint.key(),
        constraint = buyer_grow.owner == buyer.key(),
    )]
    pub buyer_grow: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = grow_mint,
        associated_token::authority = seller,
    )]
    pub seller_grow: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        seeds = [b"marketplace"],
        bump = marketplace.bump
    )]
    pub marketplace: Account<'info, Marketplace>,

    #[account(
        mut,
        seeds = [b"listing", nft_mint.key().as_ref()],
        bump = listing.bump,
        close = seller,
        has_one = seller
    )]
    pub listing: Account<'info, Listing>,

    pub nft_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = nft_mint,
        associated_token::authority = listing,
    )]
    pub nft_vault: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = seller,
        associated_token::mint = nft_mint,
        associated_token::authority = seller,
    )]
    pub seller_nft: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum EscrowError {
    #[msg("Fee basis points too high")]
    FeeTooHigh,
    #[msg("Price must be greater than zero")]
    InvalidPrice,
    #[msg("Mint is not a 0-decimal NFT")]
    NotNft,
    #[msg("Seller does not hold the NFT")]
    MissingNft,
    #[msg("Listing is not active")]
    ListingNotActive,
    #[msg("Seller mismatch")]
    SellerMismatch,
    #[msg("Mint mismatch")]
    MintMismatch,
    #[msg("Buyer cannot be the seller")]
    BuyerIsSeller,
    #[msg("Math overflow")]
    MathOverflow,
}
