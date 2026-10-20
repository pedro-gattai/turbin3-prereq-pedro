import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PreReqVault } from "../target/types/pre_req_vault";
import {
  Commitment,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import NodeWallet from "@anchor-lang/core/dist/cjs/nodewallet";
import { BN } from "bn.js";
import { expect } from "chai";

// IDL of the Turbin3 registration program (devnet). Used only to READ the
// application account after the withdraw, so the test can prove the CPI worked.
const registrationIdl = require("../idls/registration.json");

const commitement: Commitment = "confirmed";

// GitHub username recorded on-chain by the registration program.
// Override with GITHUB_USERNAME=<name> anchor test
const GITHUB_USERNAME = process.env.GITHUB_USERNAME ?? "pedro-gattai";

describe("pre-req-vault", () => {
  const confirmTx = async (signature: string) => {
    console.log(`Transaction signature: ${signature}`);
    const latestBlockhash = await anchor
      .getProvider()
      .connection.getLatestBlockhash();
    await anchor.getProvider().connection.confirmTransaction(
      {
        signature,
        ...latestBlockhash,
      },
      commitement,
    );
  };

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.preReqVault as Program<PreReqVault>;
  const user = provider.wallet.publicKey;

  // Read-only client for the registration program (address comes from the IDL)
  const registration = new Program(registrationIdl, provider);
  const applicationProgram = registration.programId;
  const applicationAccount = PublicKey.findProgramAddressSync(
    [Buffer.from("prereqs"), user.toBuffer()],
    applicationProgram,
  )[0];

  // Derive PDAs

  const [vaultStatePda, stateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("state"), user.toBuffer()],
    program.programId,
  );

  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), vaultStatePda.toBuffer()],
    program.programId,
  );

  //   before(async () => {
  //     const sig = await provider.connection.requestAirdrop(
  //       user,
  //       10 * LAMPORTS_PER_SOL,
  //     );
  //     await confirmTx(sig);
  //   });

  it("Initialize the vault", async () => {
    const tx = await program.methods
      .initialize()
      .accountsStrict({
        user: user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);

    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultState.vaultBump).to.equal(vaultBump);
    expect(vaultState.stateBump).to.equal(stateBump);
  });

  it(" Deposilt 1 Sol in to the vault", async () => {
    const depositAmount = 1 * LAMPORTS_PER_SOL;

    const initialVaultBalance = await provider.connection.getBalance(vaultPda);
    const intialUserBalance = await provider.connection.getBalance(user);

    const tx = await program.methods
      .deposit(new BN(depositAmount))
      .accountsStrict({
        user: user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);

    const finalBalanceVault = await provider.connection.getBalance(vaultPda);
    const finalBalanceUser = await provider.connection.getBalance(user);

    expect(finalBalanceVault).to.equal(initialVaultBalance + depositAmount);
    expect(finalBalanceUser).to.be.lessThan(intialUserBalance - depositAmount);
  });

  it(" Withdraw 0.5 Sol from the vault and register via CPI", async () => {
    const withdrawAmount = 0.5 * LAMPORTS_PER_SOL;

    const initialVaultBalance = await provider.connection.getBalance(vaultPda);
    const intialUserBalance = await provider.connection.getBalance(user);

    // The registration program allows one registration per wallet, so the
    // application account must not exist yet.
    expect(await provider.connection.getAccountInfo(applicationAccount)).to.be
      .null;

    const tx = await program.methods
      .withdraw(new BN(withdrawAmount), GITHUB_USERNAME)
      .accountsStrict({
        user: user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
        applicationAccount,
        applicationProgram,
      })
      .rpc();

    await confirmTx(tx);

    const finalBalanceVault = await provider.connection.getBalance(vaultPda);
    const finalBalanceUser = await provider.connection.getBalance(user);

    expect(finalBalanceVault).to.equal(initialVaultBalance - withdrawAmount);
    // user receives 0.5 SOL but pays the tx fee + rent of the new application account
    expect(finalBalanceUser).to.be.greaterThan(intialUserBalance);

    // Success criteria: the registration program recorded our details.
    const application = await registration.account.applicationAccount.fetch(
      applicationAccount,
    );
    console.log(`Application account: ${applicationAccount.toBase58()}`);
    expect(application.user.toBase58()).to.equal(user.toBase58());
    expect(application.github).to.equal(GITHUB_USERNAME);
    expect(application.preReqTs).to.equal(false);
    expect(application.preReqRs).to.equal(false);
  });

  it(" Close the vault and withdraw all the funds", async () => {
    const initialUserBalance = await provider.connection.getBalance(user);

    const tx = await program.methods
      .close()
      .accountsStrict({
        user: user,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await confirmTx(tx);

    expect(await provider.connection.getBalance(vaultPda)).to.equal(0);

    const vaultStateInfo = await provider.connection.getAccountInfo(
      vaultStatePda,
    );
    expect(vaultStateInfo).to.be.null;

    const finalUserBalance = await provider.connection.getBalance(user);
    expect(finalUserBalance).to.be.greaterThan(initialUserBalance);
  });
});
