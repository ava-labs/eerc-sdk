import type { useEncryptedBalance } from "./useEncryptedBalance";

export type EncryptedBalance = [ContractCipher, ContractCipher];

export type ContractCipher = {
  c1: PPoint;
  c2: PPoint;
};

export type PPoint = {
  x: bigint;
  y: bigint;
};

export type OperationResult = {
  transactionHash: `0x${string}`;
};

export type DecryptedTransaction = {
  type: string;
  amount: string;
  sender: `0x${string}`;
  receiver: `0x${string}` | null;
  transactionHash: `0x${string}`;
};

export type EERCHookResult = {
  isInitialized: boolean;
  isAllDataFetched: boolean;
  isRegistered: boolean;
  isConverter: boolean;
  publicKey: bigint[];
  auditorAddress: `0x${string}`;
  owner: string;
  auditorPublicKey: bigint[];
  isAuditorKeySet: boolean;
  name: string;
  symbol: string;
  isDecryptionKeySet: boolean;
  areYouAuditor: boolean;
  hasBeenAuditor: {
    isChecking: boolean;
    isAuditor: boolean;
  };
  generateDecryptionKey: () => Promise<string>;
  register: () => Promise<{ key: string; transactionHash: string }>;
  auditorDecrypt: () => Promise<DecryptedTransaction[]>;
  isAddressRegistered: (
    address: `0x${string}`,
  ) => Promise<{ isRegistered: boolean; error: string | null }>;
  useEncryptedBalance: (
    tokenAddress?: `0x${string}`,
  ) => ReturnType<typeof useEncryptedBalance>;
  refetchEercUser: () => void;
  refetchAuditor: () => void;
  setContractAuditorPublicKey: (
    address: `0x${string}`,
  ) => Promise<`0x${string}`>;
};

export type UseEncryptedBalanceHookResult = {
  decryptedBalance: bigint;
  parsedDecryptedBalance: string;
  encryptedBalance: bigint[];
  auditorPublicKey: bigint[];
  decimals: bigint;
  decryptMessage: (transactionHash: string) => Promise<DecryptedMetadata>;
  privateMint: (
    recipient: `0x${string}`,
    amount: bigint,
    message?: string,
  ) => Promise<OperationResult>;
  privateBurn: (amount: bigint, message?: string) => Promise<OperationResult>;
  privateTransfer: (
    to: string,
    amount: bigint,
    message?: string,
  ) => Promise<{
    transactionHash: `0x${string}`;
    receiverEncryptedAmount: string[];
    senderEncryptedAmount: string[];
  }>;
  withdraw: (amount: bigint, message?: string) => Promise<OperationResult>;
  deposit: (amount: bigint, message?: string) => Promise<OperationResult>;
  refetchBalance: () => void;
};

export interface IBalanceState {
  decrypted: bigint;
  parsed: string;
  encrypted: bigint[];
}

export interface IEERCState {
  isConverter: boolean;
  isInitialized: boolean;
  auditorPublicKey: bigint[];
  owner: string;
  name: string;
  symbol: string;
  registrarAddress: string;
  isRegistered: boolean;
  isAllDataFetched: boolean;
  hasBeenAuditor: {
    isChecking: boolean;
    isAuditor: boolean;
  };
}
export type CircuitURLs = {
  register: {
    wasm: string;
    zkey: string;
  };
  transfer: {
    wasm: string;
    zkey: string;
  };
  mint: {
    wasm: string;
    zkey: string;
  };
  withdraw: {
    wasm: string;
    zkey: string;
  };
  burn: {
    wasm: string;
    zkey: string;
  };
};

export type eERC_Proof = {
  proofPoints: {
    a: string[];
    b: string[][];
    c: string[];
  };
  publicSignals: string[];
};

export type DecryptedMetadata = {
  decryptedMessage: string;
  messageType: string;
  messageFrom: `0x${string}`;
  messageTo: `0x${string}`;
};
