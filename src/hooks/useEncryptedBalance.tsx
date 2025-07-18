import { useCallback, useEffect, useMemo, useState } from "react";
import type { WalletClient } from "viem";
import { useBlockNumber, useReadContract } from "wagmi";
import type { EERC } from "../EERC";
import type { AmountPCT, EGCT, Point } from "../crypto/types";
import { ENCRYPTED_ERC_ABI } from "../utils";
import type { IBalanceState, UseEncryptedBalanceHookResult } from "./types";

export function useEncryptedBalance(
  eerc: EERC | undefined,
  contractAddress: string,
  wallet: WalletClient,
  tokenAddress?: `0x${string}`,
): UseEncryptedBalanceHookResult {
  const { data: blockNumber } = useBlockNumber({ watch: true });

  const [balanceState, setBalanceState] = useState<IBalanceState>({
    decrypted: 0n,
    parsed: "",
    encrypted: [],
  });
  const [auditorPublicKey, setAuditorPublicKey] = useState<bigint[]>([]);

  const eercContract = useMemo(
    () => ({
      address: contractAddress as `0x${string}`,
      abi: ENCRYPTED_ERC_ABI,
    }),
    [contractAddress],
  );

  /**
   * fetch contract balance of the user
   */
  const { data: contractBalance, refetch: refetchBalance } = useReadContract({
    ...eercContract,
    functionName: tokenAddress ? "getBalanceFromTokenAddress" : "balanceOf",
    args: [wallet?.account?.address, tokenAddress || 0n],
    query: {
      enabled: !!wallet?.account?.address,
    },
  });

  /**
   * fetch decimals of the eERC token
   */
  const { data: decimals } = useReadContract({
    ...eercContract,
    functionName: "decimals",
    query: {
      enabled: !!contractAddress,
    },
  }) as { data: bigint };

  /**
   * fetch auditor public key
   */
  const { data: auditorData, refetch: refetchAuditorPublicKey } =
    useReadContract({
      ...eercContract,
      functionName: "auditorPublicKey",
      args: [],
    });

  useEffect(() => {
    if (!auditorData) return;
    setAuditorPublicKey(auditorData as bigint[]);
  }, [auditorData]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: we need to refetch balance every block
  useEffect(() => {
    // refetch balance is every block
    refetchBalance();
    refetchAuditorPublicKey();
  }, [blockNumber]);

  useEffect(() => {
    let mounted = true;

    if (
      !contractBalance ||
      !eerc ||
      !eerc.isDecryptionKeySet ||
      !wallet?.account?.address
    ) {
      return;
    }

    // Verify the decryption key matches the current wallet
    // if not reset the balance state and return
    if (eerc?.wallet?.account?.address !== wallet.account.address) {
      setBalanceState({
        decrypted: 0n,
        parsed: "",
        encrypted: [],
      });
      return;
    }

    const contractBalanceArray = contractBalance as bigint[];
    const elGamalCipherText = contractBalanceArray[0] as unknown as EGCT;
    const amountPCTs = contractBalanceArray[2] as unknown as AmountPCT[];
    const balancePCT = contractBalanceArray[3] as unknown as bigint[];

    const totalBalance = eerc.calculateTotalBalance(
      elGamalCipherText,
      amountPCTs,
      balancePCT,
    );

    if (mounted) {
      setBalanceState((prev) => ({
        ...prev,
        decrypted: totalBalance,
        parsed: totalBalance.toString(),
        encrypted: [
          elGamalCipherText.c1.x,
          elGamalCipherText.c1.y,
          elGamalCipherText.c2.x,
          elGamalCipherText.c2.y,
        ],
      }));
    }

    return () => {
      mounted = false;
    };
  }, [contractBalance, eerc, wallet?.account?.address]);

  /**
   * mint amount of encrypted tokens to the user
   * @param recipient - recipient address
   * @param amount - amount to mint
   * @param message - message to encrypt
   * @returns object - returns transaction hash
   */
  const privateMint = useCallback(
    (recipient: `0x${string}`, amount: bigint, message?: string) => {
      if (!eerc || !auditorPublicKey) throw new Error("EERC not initialized");
      if (
        !auditorPublicKey.length ||
        auditorPublicKey.some((key) => key === 0n)
      )
        throw new Error("Auditor public key is not set");

      return eerc.privateMint(
        recipient,
        amount,
        auditorPublicKey as Point,
        message,
      );
    },
    [eerc, auditorPublicKey],
  );

  /**
   * burns amount of encrypted tokens from the user
   * @param amount - amount to burn
   * @returns object - returns transaction hash
   */
  const privateBurn = useCallback(
    (amount: bigint, message?: string) => {
      try {
        if (!eerc || !balanceState.encrypted.length)
          throw new Error("EERC not initialized");
        if (
          !auditorPublicKey.length ||
          auditorPublicKey.some((key) => key === 0n)
        )
          throw new Error("Auditor public key is not set");
        if (balanceState.decrypted < amount || amount <= 0n)
          throw new Error("Invalid amount");

        return eerc.privateBurn(
          amount,
          balanceState.encrypted,
          balanceState.decrypted,
          auditorPublicKey as Point,
          message,
        );
      } catch (error) {
        console.error("Private burn failed", error);
        throw error;
      }
    },
    [eerc, auditorPublicKey, balanceState],
  );

  /**
   * transfers amount of encrypted tokens to the user
   * @param to - recipient address
   * @param amount - amount to transfer
   * @returns object - returns transaction hash
   */
  const privateTransfer = useCallback(
    (to: string, amount: bigint, message?: string) => {
      try {
        if (!eerc || !balanceState.encrypted.length)
          throw new Error("EERC not initialized");
        if (
          !auditorPublicKey.length ||
          auditorPublicKey.some((key) => key === 0n)
        )
          throw new Error("Auditor public key is not set");
        if (balanceState.decrypted < amount || amount <= 0n)
          throw new Error("Invalid amount");

        return eerc.transfer(
          to,
          amount,
          balanceState.encrypted,
          balanceState.decrypted,
          auditorPublicKey,
          tokenAddress,
          message,
        );
      } catch (error) {
        console.error("Private transfer failed", error);
        throw error;
      }
    },
    [eerc, auditorPublicKey, balanceState, tokenAddress],
  );

  /**
   * deposit amount of tokens to the user
   * @param amount - amount to deposit
   * @returns object - returns transaction hash
   */
  const deposit = useCallback(
    (amount: bigint, message?: string) => {
      try {
        if (!eerc) throw new Error("EERC not initialized");
        if (!tokenAddress) throw new Error("Token address is not set");
        if (!decimals) throw new Error("Decimals not set");
        if (
          !auditorPublicKey.length ||
          auditorPublicKey.some((key) => key === 0n)
        )
          throw new Error("Auditor public key is not set");

        return eerc.deposit(amount, tokenAddress, decimals, message);
      } catch (error) {
        console.error("Deposit failed", error);
        throw error;
      }
    },
    [eerc, tokenAddress, decimals, auditorPublicKey],
  );

  /**
   * withdraw amount of tokens from the user
   * @param amount - amount to withdraw
   * @returns object - returns transaction hash
   */
  const withdraw = useCallback(
    (amount: bigint, message?: string) => {
      try {
        if (!eerc) throw new Error("EERC not initialized");
        if (!tokenAddress) throw new Error("Token address is not set");
        if (
          !auditorPublicKey.length ||
          auditorPublicKey.some((key) => key === 0n)
        )
          throw new Error("Auditor public key is not set");

        return eerc.withdraw(
          amount,
          balanceState.encrypted,
          balanceState.decrypted,
          auditorPublicKey,
          tokenAddress,
          message,
        );
      } catch (error) {
        console.error("Withdraw failed", error);
        throw error;
      }
    },
    [eerc, balanceState, tokenAddress, auditorPublicKey],
  );

  const decryptMessage = useCallback(
    (transactionHash: string) => {
      if (!eerc) throw new Error("EERC not initialized");
      return eerc.decryptMessage(transactionHash);
    },
    [eerc],
  );

  return {
    decryptedBalance: balanceState.decrypted, // decrypted balance of the user
    parsedDecryptedBalance: balanceState.parsed, // parsed decrypted balance of the user
    encryptedBalance: balanceState.encrypted, // encrypted balance of the user
    auditorPublicKey, // auditor's public key
    decimals, // decimals of the token

    // functions
    privateMint,
    privateBurn,
    privateTransfer,
    withdraw,
    deposit,
    decryptMessage,

    // refetch
    refetchBalance,
  };
}
