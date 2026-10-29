import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { PUMP_AMM_SDK } from "../packages/sdk/src/swap/index.ts";

const require = createRequire(
  new URL("../packages/sdk/package.json", import.meta.url),
);
const {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} = require("@solana/spl-token");
const { PublicKey } = require("@solana/web3.js");

const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const tokenAccount = () => ({
  data: Buffer.alloc(165),
  executable: false,
  lamports: 2_039_280,
  owner: TOKEN_PROGRAM_ID,
});
const hasClose = (
  instructions: Awaited<ReturnType<typeof PUMP_AMM_SDK.collectCoinCreatorFee>>,
  account: InstanceType<typeof PublicKey>,
) =>
  instructions.some(
    (instruction) =>
      instruction.programId.equals(TOKEN_PROGRAM_ID) &&
      instruction.keys[0]?.pubkey.equals(account) &&
      instruction.data.equals(Buffer.from([9])),
  );

async function collect(
  coinCreatorTokenAccount: InstanceType<typeof PublicKey>,
) {
  const coinCreator = key(1);
  return {
    coinCreator,
    instructions: await PUMP_AMM_SDK.collectCoinCreatorFee({
      coinCreator,
      quoteMint: NATIVE_MINT,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
      coinCreatorVaultAuthority: key(3),
      coinCreatorVaultAta: key(4),
      coinCreatorTokenAccount,
      coinCreatorVaultAtaAccountInfo: tokenAccount(),
      coinCreatorTokenAccountInfo: tokenAccount(),
    }),
  };
}

test("collectCoinCreatorFee keeps an existing custom WSOL account open", async () => {
  const custom = key(2);
  const { coinCreator, instructions } = await collect(custom);
  assert.notEqual(
    custom.toBase58(),
    getAssociatedTokenAddressSync(
      NATIVE_MINT,
      coinCreator,
      true,
      TOKEN_PROGRAM_ID,
    ).toBase58(),
  );
  assert.equal(hasClose(instructions, custom), false);
});

test("collectCoinCreatorFee still closes the creator's WSOL ATA", async () => {
  const coinCreator = key(1);
  const ata = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    coinCreator,
    true,
    TOKEN_PROGRAM_ID,
  );
  assert.equal(hasClose((await collect(ata)).instructions, ata), true);
});
