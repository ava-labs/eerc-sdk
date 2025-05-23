import { useCallback, useEffect, useMemo, useState } from "react";
import type { Abi, PublicClient, WalletClient } from "viem";
import { useBlockNumber, useReadContract, useReadContracts } from "wagmi";
import { EERC } from "../EERC";
import type { Point } from "../crypto/types";
import { logMessage } from "../helpers";
import { ENCRYPTED_ERC_ABI } from "../utils";
import { REGISTRAR_ABI } from "../utils/Registrar.abi";
import type {
  CircuitURLs,
  DecryptedTransaction,
  EERCHookResult,
  IEERCState,
} from "./types";
import { useEncryptedBalance } from "./useEncryptedBalance";

export function useEERC(
  client: PublicClient,
  wallet: WalletClient,
  contractAddress: string,
  circuitURLs: CircuitURLs,
  decryptionKey?: string,
): EERCHookResult {
  const { data: blockNumber } = useBlockNumber({ watch: true });
  const [eerc, setEerc] = useState<EERC | undefined>(undefined);
  const [eercState, setEercState] = useState<IEERCState>({
    isInitialized: false,
    isConverter: false,
    auditorPublicKey: [],
    name: "",
    symbol: "",
    registrarAddress: "",
    isRegistered: false,
    isAllDataFetched: false,
    owner: "",
    hasBeenAuditor: {
      isChecking: false,
      isAuditor: false,
    },
  });
  const [generatedDecryptionKey, setGeneratedDecryptionKey] =
    useState<string>("");

  const updateEercState = useCallback(
    (updates: Partial<IEERCState>) =>
      setEercState((prevState) => ({ ...prevState, ...updates })),
    [],
  );

  const eercContract = useMemo(
    () => ({
      address: contractAddress as `0x${string}`,
      abi: ENCRYPTED_ERC_ABI as Abi,
    }),
    [contractAddress],
  );

  const registrarContract = useMemo(
    () => ({
      address: eercState.registrarAddress as `0x${string}`,
      abi: REGISTRAR_ABI as Abi,
    }),
    [eercState.registrarAddress],
  );

  const circuitURLsKey = useMemo(() => {
    return JSON.stringify(circuitURLs);
  }, [circuitURLs]);

  /**
   * get user data for checking is user registered
   */
  const {
    data: userData,
    isFetched: isUserDataFetched,
    refetch: refetchEercUser,
  } = useReadContract({
    ...registrarContract,
    functionName: "getUserPublicKey",
    args: [wallet?.account?.address],
    query: {
      enabled: Boolean(eerc && wallet?.account?.address && registrarContract),
    },
  });

  useEffect(() => {
    if (userData && isUserDataFetched) {
      const data = userData as Point;
      updateEercState({
        isRegistered: !(data[0] === 0n && data[1] === 0n),
      });
    }
  }, [userData, isUserDataFetched, updateEercState]);

  /**
   * get contract name,symbol,registrar address and isConverter or not
   */
  const { data: contractData, isFetched: isContractDataFetched } =
    useReadContracts({
      contracts: [
        {
          ...eercContract,
          functionName: "name",
          args: [],
        },
        {
          ...eercContract,
          functionName: "symbol",
          args: [],
        },
        {
          ...eercContract,
          functionName: "registrar",
        },
        {
          ...eercContract,
          functionName: "isConverter",
        },
        {
          ...eercContract,
          functionName: "owner",
        },
      ],
      query: {
        enabled: Boolean(contractAddress),
      },
    });

  // update name and symbol data
  useEffect(() => {
    if (contractData && isContractDataFetched) {
      const [
        nameData,
        symbolData,
        registrarAddress,
        isConverterData,
        ownerData,
      ] = contractData;

      updateEercState({
        name: nameData.status === "success" ? (nameData.result as string) : "",
        symbol:
          symbolData.status === "success" ? (symbolData.result as string) : "",
        registrarAddress:
          registrarAddress.status === "success"
            ? (registrarAddress.result as string)
            : "",
        isConverter:
          isConverterData.status === "success"
            ? (isConverterData.result as boolean)
            : false,
        owner:
          ownerData.status === "success"
            ? (ownerData.result as `0x${string}`)
            : "",
      });
    }
  }, [contractData, isContractDataFetched, updateEercState]);

  /**
   * fetch auditor public key
   */
  const {
    data: auditorPublicKeyData,
    isFetched: isAuditorPublicKeyFetched,
    refetch: refetchAuditor,
  } = useReadContract({
    ...eercContract,
    functionName: "auditorPublicKey",
    args: [],
    query: {
      enabled: Boolean(contractAddress) && Boolean(eerc),
    },
  });

  useEffect(() => {
    if (auditorPublicKeyData && isAuditorPublicKeyFetched) {
      updateEercState({
        auditorPublicKey: auditorPublicKeyData as bigint[],
      });
    }
  }, [auditorPublicKeyData, isAuditorPublicKeyFetched, updateEercState]);

  const {
    data: auditorAddress,
    isFetched: isAuditorAddressFetched,
    refetch: refetchAuditorAddress,
  } = useReadContract({
    ...eercContract,
    functionName: "auditor",
    args: [],
    query: {
      enabled: Boolean(contractAddress) && Boolean(eerc),
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: we don't need to refetch on every render
  useEffect(() => {
    // when blocknumber changes refetch
    // - user public key
    // - auditor public key
    // - auditor address
    refetchEercUser();
    refetchAuditor();
    refetchAuditorAddress();
  }, [blockNumber]);

  /**
   * check if user has been auditor
   */
  const checkIsAuditor = useCallback(async () => {
    if (!eerc) return;

    try {
      updateEercState({
        hasBeenAuditor: { isChecking: true, isAuditor: false },
      });
      const isAuditor = await eerc.hasBeenAuditor();
      updateEercState({
        hasBeenAuditor: { isChecking: false, isAuditor },
      });
    } catch (error) {
      setEercState((prevState) => ({
        ...prevState,
        hasBeenAuditor: {
          ...prevState.hasBeenAuditor,
          isChecking: false,
        },
      }));
      logMessage(`Failed to check is auditor: ${error}`);
    }
  }, [eerc, updateEercState]);

  useEffect(() => {
    if (eerc) {
      checkIsAuditor();
    }
  }, [eerc, checkIsAuditor]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: we want to reset the key when wallet changes
  useEffect(() => {
    setGeneratedDecryptionKey("");
  }, [wallet?.account?.address]);

  // check is all data fetched
  useEffect(() => {
    if (
      isUserDataFetched &&
      isContractDataFetched &&
      isAuditorPublicKeyFetched &&
      isAuditorAddressFetched
    ) {
      logMessage("All data fetched");
      updateEercState({
        isAllDataFetched: true,
      });
    }

    return () => {
      updateEercState({
        isAllDataFetched: false,
      });
    };
  }, [
    isUserDataFetched,
    isContractDataFetched,
    isAuditorPublicKeyFetched,
    isAuditorAddressFetched,
    updateEercState,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: circuitURLsKey is a stable key for circuitURLs
  useEffect(() => {
    let mounted = true;

    const initializeEERC = async () => {
      if (
        !client ||
        !wallet?.account?.address ||
        !contractAddress ||
        eercState.isConverter === undefined ||
        !eercState.registrarAddress ||
        eercState.isInitialized ||
        !circuitURLs
      )
        return;

      try {
        const correctKey = decryptionKey || generatedDecryptionKey;
        if (!correctKey) {
          logMessage("Decryption key is not set");
        }

        const _eerc = new EERC(
          client,
          wallet,
          contractAddress as `0x${string}`,
          eercState.registrarAddress as `0x${string}`,
          eercState.isConverter,
          circuitURLs,
          correctKey,
        );

        if (mounted) {
          setEerc(_eerc);
          updateEercState({
            isInitialized: true,
          });
        }
      } catch (error) {
        logMessage(`Failed to initialize EERC: ${error}`);
      }
    };

    initializeEERC();

    // Cleanup function to reset state only when necessary
    return () => {
      mounted = false;
      if (eercState.isInitialized) {
        updateEercState({
          isInitialized: false,
        });
        setEerc(undefined);
      }
    };
  }, [
    client,
    wallet,
    contractAddress,
    eercState.isConverter,
    eercState.registrarAddress,
    decryptionKey,
    eercState.isInitialized,
    updateEercState,
    generatedDecryptionKey,
    circuitURLsKey,
  ]);

  /**
   * check if the decryption key should be generated
   * @returns boolean - returns true if user is registered and decryption key is not set
   */
  const isDecryptionKeySet = useMemo(() => {
    if (!eerc) {
      return false;
    }
    return eerc?.isDecryptionKeySet;
  }, [eerc]);

  /**
   * register user to the EERC contract
   * @returns object - returns the key and transaction hash
   */
  const register = useCallback(() => {
    if (!eerc) {
      throw new Error("EERC not initialized");
    }
    return eerc.register();
  }, [eerc]);

  /**
   * generate decryption key
   * @returns string - decryption key
   */
  const generateDecryptionKey = useCallback(async () => {
    if (!eerc) {
      throw new Error("EERC not initialized");
    }
    // generate decryption key
    const key = await eerc.generateDecryptionKey();
    // set decryption key
    setGeneratedDecryptionKey(key);
    // return decryption key
    return key;
  }, [eerc]);

  /**
   * decrypt the encrypted data by the auditor public key
   * @returns array of decrypted transactions
   */
  const auditorDecrypt = useCallback((): Promise<DecryptedTransaction[]> => {
    if (!eerc) {
      throw new Error("EERC not initialized");
    }
    return eerc.auditorDecrypt();
  }, [eerc]);

  /**
   * check is the address is registered to the contract
   * @param address - address to check
   * @returns object - returns isRegistered and error
   */
  const isAddressRegistered = useCallback(
    async (address: `0x${string}`) => {
      try {
        const data = await eerc?.fetchPublicKey(address);
        if (!data) return { isRegistered: false, error: null };

        return {
          isRegistered: !(data[0] === 0n || data[1] === 0n),
          error: null,
        };
      } catch {
        throw new Error("Failed to check address registration");
      }
    },
    [eerc],
  );

  /**
   * returns the encrypted balance hook
   * @param tokenAddress - token address
   * @returns encrypted balance hook
   */
  const useEncryptedBalanceHook = (tokenAddress?: `0x${string}`) =>
    useEncryptedBalance(eerc, contractAddress, wallet, tokenAddress);

  /**
   * check is user auditor
   * @returns boolean - returns true if user is auditor
   */
  const areYouAuditor = useMemo(() => {
    if (!eerc || !eercState.auditorPublicKey.length) {
      return false;
    }

    return (
      eercState.auditorPublicKey[0] === eerc?.publicKey[0] &&
      eercState.auditorPublicKey[1] === eerc?.publicKey[1]
    );
  }, [eerc, eercState.auditorPublicKey]);

  /**
   * set contract auditor public key
   * @param address - auditor address
   * @returns object - returns transaction hash
   */
  const setContractAuditorPublicKey = useCallback(
    (address: `0x${string}`) => {
      if (!eerc) throw new Error("EERC not initialized");
      return eerc.setContractAuditorPublicKey(address);
    },
    [eerc],
  );

  return {
    isInitialized: eercState.isInitialized, // is sdk initialized
    isAllDataFetched: eercState.isAllDataFetched, // is all data fetched
    isRegistered: eercState.isRegistered, // is user registered to the contract
    isConverter: eercState.isConverter, // is contract converter
    publicKey: eerc?.publicKey ?? [], // user's public key
    auditorAddress: auditorAddress as `0x${string}`, // auditor address
    owner: eercState.owner, // owner address
    auditorPublicKey: eercState.auditorPublicKey, // auditor's public key
    isAuditorKeySet: Boolean(
      eercState.auditorPublicKey.length > 0 &&
        eercState.auditorPublicKey[0] !== 0n &&
        eercState.auditorPublicKey[1] !== 0n,
    ),
    name: eercState.name, // EERC name, (only for stand-alone version)
    symbol: eercState.symbol, // EERC symbol, (only for stand-alone version)
    isDecryptionKeySet,
    areYouAuditor,
    hasBeenAuditor: eercState.hasBeenAuditor,

    // functions
    register, // register user to the contract
    auditorDecrypt, // auditor decryption
    isAddressRegistered, // function for checking address is registered or not
    generateDecryptionKey, // generate decryption key
    setContractAuditorPublicKey, // set contract auditor public key

    // refetch
    refetchEercUser,
    refetchAuditor,

    // hooks
    useEncryptedBalance: useEncryptedBalanceHook,
  };
}
