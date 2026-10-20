pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("8PL7Lrg666iVa8W2pBdcJxC975c2UWAxgt8ry94DGQgd");

#[program]
pub mod pre_req_vault {
    use super::*;

    // Initialize
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.intialize(&ctx.bumps)
    }

    // deposit funds
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        ctx.accounts.deposit(amount)
    }

    // withdraw funds and register the user (CPI to the registration program)
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64, github: String) -> Result<()> {
        ctx.accounts.withdraw(amount, github)
    }

    // close
    pub fn close(ctx: Context<Close>) -> Result<()> {
        ctx.accounts.close()
    }
}
