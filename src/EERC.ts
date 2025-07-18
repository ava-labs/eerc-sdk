import { poseidon3, poseidon5 } from "poseidon-lite";
import * as snarkjs from "snarkjs";
import {
  type Account,
  type Log,
  type PublicClient,
  type WalletClient,
  decodeFunctionData,
  erc20Abi,
  isAddress,
} from "viem";
import { BabyJub } from "./crypto/babyjub";
import { FF } from "./crypto/ff";
import { formatKeyForCurve, getPrivateKeyFromSignature } from "./crypto/key";
import { Poseidon } from "./crypto/poseidon";
import type { AmountPCT, EGCT, Point } from "./crypto/types";
import { logMessage } from "./helpers";
import { decryptMetadata, encryptMetadata } from "./helpers/metadata";
import type {
  CircuitURLs,
  DecryptedMetadata,
  DecryptedTransaction,
  OperationResult,
  eERC_Proof,
} from "./hooks/types";
import {
  BURN_USER,
  DEPOSIT_WITH_MESSAGE_ABI,
  ENCRYPTED_ERC_ABI,
  MESSAGES,
  PRIVATE_BURN_EVENT,
  PRIVATE_BURN_WITH_MESSAGE_ABI,
  PRIVATE_MESSAGE_EVENT,
  PRIVATE_MINT_EVENT,
  PRIVATE_MINT_WITH_MESSAGE_ABI,
  PRIVATE_TRANSFER_EVENT,
  REGISTRAR_ABI,
  SNARK_FIELD_SIZE,
  TRANSFER_WITH_MESSAGE_ABI,
  WITHDRAW_WITH_MESSAGE_ABI,
} from "./utils";

export class EERC {
  private client: PublicClient;
  public wallet: WalletClient;

  public curve: BabyJub;
  public field: FF;
  public poseidon: Poseidon;

  public contractAddress: `0x${string}`;
  public isConverter: boolean;
  public encryptedErcAbi = ENCRYPTED_ERC_ABI;

  public registrarAddress: `0x${string}`;
  public registrarAbi = REGISTRAR_ABI;

  private decryptionKey: string;
  public publicKey: bigint[] = [];

  private circuitURLs: CircuitURLs;

  constructor(
    client: PublicClient,
    wallet: WalletClient,
    contractAddress: `0x${string}`,
    registrarAddress: `0x${string}`,
    isConverter: boolean,
    circuitURLs: CircuitURLs,
    decryptionKey?: string,
  ) {
    this.client = client;
    this.wallet = wallet;
    this.contractAddress = contractAddress;
    this.registrarAddress = registrarAddress;
    this.isConverter = isConverter;
    this.circuitURLs = circuitURLs;

    this.field = new FF(SNARK_FIELD_SIZE);
    this.curve = new BabyJub(this.field);
    this.poseidon = new Poseidon(this.field, this.curve);
    this.decryptionKey = decryptionKey || "";

    if (this.decryptionKey) {
      const formatted = formatKeyForCurve(this.decryptionKey);
      this.publicKey = this.curve.generatePublicKey(formatted);
    }
  }

  /**
   * throws an error with EERCError class
   * @param message error message
   */
  private throwError(message: string) {
    throw new Error(message);
  }

  /**
   * checks that provided address is a valid address
   * @param address address to validate
   */
  private validateAddress(address: string) {
    if (!isAddress(address)) throw new Error("Invalid address!");
  }

  /**
   * checks that amount is greater than 0 and if sender balance is provided, checks that amount is less than sender balance
   * @param amount amount
   * @param senderBalance sender balance - optional
   */
  private validateAmount(amount: bigint, senderBalance?: bigint) {
    if (amount <= 0n) throw new Error("Invalid amount!");
    if (senderBalance && amount > senderBalance)
      throw new Error("Insufficient balance!");
  }

  /**
   * function to set the auditor public key
   * @param address auditor address
   * @returns transaction hash
   */
  public async setContractAuditorPublicKey(address: `0x${string}`) {
    try {
      const { request } = await this.client.simulateContract({
        abi: this.encryptedErcAbi,
        address: this.contractAddress,
        functionName: "setAuditorPublicKey",
        args: [address],
        account: this.wallet.account,
      });

      return await this.wallet.writeContract(request);
    } catch (e) {
      throw new Error("Failed to set auditor public key!", { cause: e });
    }
  }

  /**
   * getter to check if the decryption key is set or not
   */
  public get isDecryptionKeySet() {
    return !!this.decryptionKey;
  }

  /**
   * function to generate the decryption key
   */
  public async generateDecryptionKey() {
    if (!this.wallet || !this.client || !this.wallet.account?.address) {
      this.throwError("Missing wallet or client!");
    }

    try {
      const message = MESSAGES.REGISTER(
        this.wallet.account?.address as `0x${string}`,
      );

      // deriving the decryption key from the user signature
      const signature = await this.wallet.signMessage({
        message,
        account: this.wallet.account as Account,
      });
      const key = getPrivateKeyFromSignature(signature);

      this.decryptionKey = key;

      const formatted = formatKeyForCurve(this.decryptionKey);
      this.publicKey = this.curve.generatePublicKey(formatted);

      return key;
    } catch (error) {
      console.error("Failed to generate decryption key", error);
      throw new Error("Failed to generate decryption key!");
    }
  }

  /**
   * function to register a new user to the contract
   */
  async register(): Promise<{
    key: string;
    transactionHash: string;
  }> {
    if (
      !this.wallet ||
      !this.client ||
      !this.contractAddress ||
      !this.wallet.account?.address
    )
      throw new Error("Missing client, wallet or contract address!");

    try {
      logMessage("Registering user to the contract");

      // message to sign
      const key = await this.generateDecryptionKey();
      const formatted = formatKeyForCurve(key);
      const publicKey = this.curve.generatePublicKey(formatted);

      {
        const contractPublicKey = await this.fetchPublicKey(
          this.wallet.account.address,
        );

        // if user already registered return the key
        if (contractPublicKey[0] !== 0n && contractPublicKey[1] !== 0n) {
          this.decryptionKey = key as string;
          this.publicKey = publicKey;
          return {
            key,
            transactionHash: "",
          };
        }
      }

      // get chain id
      const chainId = await this.client.getChainId();
      // get full address
      const fullAddress = BigInt(`0x${this.wallet.account.address.slice(2)}`);
      // construct registration hash
      const registrationHash = poseidon3([chainId, formatted, fullAddress]);

      const input = {
        SenderPrivateKey: formatted,
        SenderPublicKey: publicKey,
        SenderAddress: fullAddress,
        ChainID: chainId,
        RegistrationHash: registrationHash,
      };

      const proof = await this.generateProof(input, "REGISTER");

      logMessage("Sending transaction");

      const { request } = await this.client.simulateContract({
        abi: this.registrarAbi,
        address: this.registrarAddress,
        functionName: "register",
        args: [proof],
        account: this.wallet.account,
      });

      const transactionHash = await this.wallet.writeContract(request);

      this.decryptionKey = key;
      this.publicKey = publicKey;

      // returns proof for the transaction
      return { key, transactionHash };
    } catch (e) {
      throw new Error(e as string);
    }
  }

  /**
   * function to mint private tokens for a user (ONLY FOR STANDALONE VERSION)
   * @param recipient recipient address
   * @param mintAmount mint amount
   * @param auditorPublicKey auditor public key
   * @returns transaction hash
   */
  async privateMint(
    recipient: `0x${string}`,
    mintAmount: bigint,
    auditorPublicKey: Point,
    message?: string,
  ): Promise<OperationResult> {
    if (this.isConverter) throw new Error("Not allowed for converter!");
    this.validateAddress(recipient);
    this.validateAmount(mintAmount);
    logMessage("Minting encrypted tokens");

    // fetch the receiver public key
    const receiverPublicKey = await this.fetchPublicKey(recipient);

    // encrypt the message if provided
    const encryptedMessage = message
      ? await encryptMetadata(this.poseidon, receiverPublicKey, message)
      : "";

    // 1. encrypt the total mint amount
    const { cipher: encryptedAmount, random: encryptedAmountRandom } =
      await this.curve.encryptMessage(receiverPublicKey, mintAmount);

    // 2. create pct for the receiver with the mint amount
    const {
      cipher: receiverCiphertext,
      nonce: receiverPoseidonNonce,
      authKey: receiverAuthKey,
      encryptionRandom: receiverEncryptionRandom,
    } = await this.poseidon.processPoseidonEncryption({
      inputs: [mintAmount],
      publicKey: receiverPublicKey as Point,
    });

    // 3. create pct for the auditor with the mint amount
    const {
      cipher: auditorCiphertext,
      nonce: auditorPoseidonNonce,
      authKey: auditorAuthKey,
      encryptionRandom: auditorEncryptionRandom,
    } = await this.poseidon.processPoseidonEncryption({
      inputs: [mintAmount],
      publicKey: auditorPublicKey as Point,
    });

    // 4. creates nullifier for auditor ciphertext
    const chainId = await this.client.getChainId();
    const nullifier = poseidon5([chainId, ...auditorCiphertext].map(String));

    const input = {
      ValueToMint: mintAmount,
      ChainID: chainId,
      NullifierHash: nullifier,
      ReceiverPublicKey: receiverPublicKey,
      ReceiverVTTC1: encryptedAmount.c1,
      ReceiverVTTC2: encryptedAmount.c2,
      ReceiverVTTRandom: encryptedAmountRandom,
      ReceiverPCT: receiverCiphertext,
      ReceiverPCTAuthKey: receiverAuthKey,
      ReceiverPCTNonce: receiverPoseidonNonce,
      ReceiverPCTRandom: receiverEncryptionRandom,
      AuditorPublicKey: auditorPublicKey,
      AuditorPCT: auditorCiphertext,
      AuditorPCTAuthKey: auditorAuthKey,
      AuditorPCTNonce: auditorPoseidonNonce,
      AuditorPCTRandom: auditorEncryptionRandom,
    };

    const proof = await this.generateProof(input, "MINT");

    // simulate the transaction
    const { request } = await this.client.simulateContract({
      abi: message ? PRIVATE_MINT_WITH_MESSAGE_ABI : this.encryptedErcAbi,
      address: this.contractAddress,
      functionName: "privateMint",
      args: message ? [recipient, proof, encryptedMessage] : [recipient, proof],
      account: this.wallet.account,
    });

    // send the transaction
    const transactionHash = await this.wallet.writeContract(request);

    return { transactionHash };
  }

  /**
   * function for burning encrypted tokens privately (ONLY FOR STANDALONE VERSION)
   * @param amount burn amount
   * @param encryptedBalance encrypted balance
   * @param decryptedBalance decrypted balance
   * @param auditorPublicKey auditor public key
   * @returns transaction hash
   *
   * @dev private burn is equals to private transfer to the burn user in the standalone version
   */
  async privateBurn(
    amount: bigint,
    encryptedBalance: bigint[],
    decryptedBalance: bigint,
    auditorPublicKey: bigint[],
    message?: string,
  ) {
    if (this.isConverter) throw new Error("Not allowed for converter!");
    this.validateAmount(amount, decryptedBalance);
    logMessage("Burning encrypted tokens");

    // encrypt the message if provided
    const encryptedMessage = message
      ? await encryptMetadata(this.poseidon, this.publicKey, message)
      : "";

    const privateKey = formatKeyForCurve(this.decryptionKey);

    // encrypt the amount with the user public key
    const { cipher: encryptedAmount } = await this.curve.encryptMessage(
      this.publicKey as Point,
      amount,
    );

    // create pct for the auditor
    const {
      cipher: auditorCiphertext,
      nonce: auditorPoseidonNonce,
      authKey: auditorAuthKey,
      encryptionRandom: auditorEncryptionRandom,
    } = await this.poseidon.processPoseidonEncryption({
      inputs: [amount],
      publicKey: auditorPublicKey as Point,
    });

    const senderNewBalance = decryptedBalance - amount;
    const {
      cipher: userCiphertext,
      nonce: userPoseidonNonce,
      authKey: userAuthKey,
    } = await this.poseidon.processPoseidonEncryption({
      inputs: [senderNewBalance],
      publicKey: this.publicKey as Point,
    });

    // prepare circuit inputs
    const input = {
      ValueToBurn: amount,
      SenderPrivateKey: privateKey,
      SenderPublicKey: this.publicKey,
      SenderBalance: decryptedBalance,
      SenderBalanceC1: encryptedBalance.slice(0, 2),
      SenderBalanceC2: encryptedBalance.slice(2, 4),
      SenderVTBC1: encryptedAmount.c1,
      SenderVTBC2: encryptedAmount.c2,
      AuditorPublicKey: auditorPublicKey,
      AuditorPCT: auditorCiphertext,
      AuditorPCTAuthKey: auditorAuthKey,
      AuditorPCTNonce: auditorPoseidonNonce,
      AuditorPCTRandom: auditorEncryptionRandom,
    };

    const proof = await this.generateProof(input, "BURN");

    logMessage("Sending transaction");

    // simulate the transaction
    const { request } = await this.client.simulateContract({
      abi: message ? PRIVATE_BURN_WITH_MESSAGE_ABI : this.encryptedErcAbi,
      address: this.contractAddress,
      functionName: "privateBurn",
      args: message
        ? [
            proof,
            [...userCiphertext, ...userAuthKey, userPoseidonNonce],
            encryptedMessage,
          ]
        : [proof, [...userCiphertext, ...userAuthKey, userPoseidonNonce]],
      account: this.wallet.account,
    });

    // send the transaction
    const transactionHash = await this.wallet.writeContract(request);

    return { transactionHash };
  }

  /**
   * function to transfer encrypted tokens privately
   * @param to recipient address
   * @param amount transfer amount
   * @param encryptedBalance encrypted balance
   * @param decryptedBalance decrypted balance
   * @param auditorPublicKey auditor public key
   * @param tokenAddress token address
   * @returns transaction hash
   */
  async transfer(
    to: string,
    amount: bigint,
    encryptedBalance: bigint[],
    decryptedBalance: bigint,
    auditorPublicKey: bigint[],
    tokenAddress?: string,
    message?: string,
  ): Promise<{
    transactionHash: `0x${string}`;
    receiverEncryptedAmount: string[];
    senderEncryptedAmount: string[];
  }> {
    this.validateAddress(to);
    this.validateAmount(amount, decryptedBalance);

    const receiverPublicKey = await this.fetchPublicKey(to);

    // encrypt the message if provided
    const encryptedMessage = message
      ? await encryptMetadata(this.poseidon, receiverPublicKey, message)
      : "";

    let tokenId = 0n;
    if (tokenAddress) {
      tokenId = await this.fetchTokenId(tokenAddress);
    }

    logMessage("Transferring encrypted tokens");
    const {
      proof,
      senderBalancePCT,
      receiverEncryptedAmount,
      senderEncryptedAmount,
    } = await this.generateTransferProof(
      to,
      amount,
      encryptedBalance,
      decryptedBalance,
      auditorPublicKey,
    );

    logMessage("Sending transaction");
    const { request } = await this.client.simulateContract({
      abi: message ? TRANSFER_WITH_MESSAGE_ABI : this.encryptedErcAbi,
      address: this.contractAddress,
      functionName: "transfer",
      args: message
        ? [to, tokenId, proof, senderBalancePCT, encryptedMessage]
        : [to, tokenId, proof, senderBalancePCT],
      account: this.wallet.account,
    });

    const transactionHash = await this.wallet.writeContract(request);
    logMessage("Transaction sent");

    return { transactionHash, receiverEncryptedAmount, senderEncryptedAmount };
  }

  // function to deposit tokens to the contract
  async deposit(
    amount: bigint,
    tokenAddress: string,
    eERCDecimals: bigint,
    message?: string,
  ) {
    if (!this.isConverter) throw new Error("Not allowed for stand alone!");
    if (!this.wallet.account?.address) throw new Error("Missing wallet!");

    logMessage("Depositing tokens to the contract");
    // check if the user has enough approve amount
    const approveAmount = await this.fetchUserApprove(
      this.wallet.account.address,
      tokenAddress,
    );

    if (approveAmount < amount) {
      throw new Error("Insufficient approval amount!");
    }

    // encrypt the message if provided
    const encryptedMessage = message
      ? await encryptMetadata(this.poseidon, this.publicKey, message)
      : "";

    // need to convert erc20 decimals -> eERC decimals (2)
    const decimals = await this.client.readContract({
      abi: erc20Abi,
      address: tokenAddress as `0x${string}`,
      functionName: "decimals",
    });

    const parsedAmount = this.convertTokenDecimals(
      amount,
      Number(decimals),
      Number(eERCDecimals),
    );

    // user creates new balance pct for the deposit amount
    const { cipher, nonce, authKey } =
      await this.poseidon.processPoseidonEncryption({
        inputs: [BigInt(parsedAmount)],
        publicKey: this.publicKey as Point,
      });

    logMessage("Sending transaction");

    const { request } = await this.client.simulateContract({
      abi: message ? DEPOSIT_WITH_MESSAGE_ABI : this.encryptedErcAbi,
      address: this.contractAddress as `0x${string}`,
      functionName: "deposit",
      args: message
        ? [
            amount,
            tokenAddress,
            [...cipher, ...authKey, nonce],
            encryptedMessage,
          ]
        : [amount, tokenAddress, [...cipher, ...authKey, nonce]],
      account: this.wallet.account,
    });

    // send the transaction
    const transactionHash = await this.wallet.writeContract(request);

    return { transactionHash };
  }

  // function to deposit tokens to the contract
  async withdraw(
    amount: bigint,
    encryptedBalance: bigint[],
    decryptedBalance: bigint,
    auditorPublicKey: bigint[],
    tokenAddress: string,
    message?: string,
  ): Promise<OperationResult> {
    // only work if eerc is converter
    if (!this.isConverter) throw new Error("Not allowed for stand alone!");
    this.validateAmount(amount, decryptedBalance);

    try {
      const tokenId = await this.fetchTokenId(tokenAddress);

      // encrypt the message if provided
      const encryptedMessage = message
        ? await encryptMetadata(this.poseidon, this.publicKey, message)
        : "";

      const newBalance = decryptedBalance - amount;
      const privateKey = formatKeyForCurve(this.decryptionKey);

      // 2. create pct for the user with the new balance
      const {
        cipher: senderCipherText,
        nonce: senderPoseidonNonce,
        authKey: senderAuthKey,
      } = await this.poseidon.processPoseidonEncryption({
        inputs: [newBalance],
        publicKey: this.publicKey as Point,
      });

      // 3. create pct for the auditor with the withdraw amount
      const {
        cipher: auditorCipherText,
        nonce: auditorPoseidonNonce,
        authKey: auditorAuthKey,
        encryptionRandom: auditorEncryptionRandom,
      } = await this.poseidon.processPoseidonEncryption({
        inputs: [amount],
        publicKey: auditorPublicKey as Point,
      });

      const input = {
        ValueToWithdraw: amount,
        SenderPrivateKey: privateKey,
        SenderPublicKey: this.publicKey,
        SenderBalance: decryptedBalance,
        SenderBalanceC1: encryptedBalance.slice(0, 2),
        SenderBalanceC2: encryptedBalance.slice(2, 4),
        AuditorPublicKey: auditorPublicKey,
        AuditorPCT: auditorCipherText,
        AuditorPCTAuthKey: auditorAuthKey,
        AuditorPCTNonce: auditorPoseidonNonce,
        AuditorPCTRandom: auditorEncryptionRandom,
      };

      // generate proof
      const proof = await this.generateProof(input, "WITHDRAW");

      const { request } = await this.client.simulateContract({
        abi: message ? WITHDRAW_WITH_MESSAGE_ABI : this.encryptedErcAbi,
        address: this.contractAddress as `0x${string}`,
        functionName: "withdraw",
        args: message
          ? [
              tokenId,
              proof,
              [...senderCipherText, ...senderAuthKey, senderPoseidonNonce],
              encryptedMessage,
            ]
          : [
              tokenId,
              proof,
              [...senderCipherText, ...senderAuthKey, senderPoseidonNonce],
            ],
        account: this.wallet.account,
      });

      const transactionHash = await this.wallet.writeContract(request);

      return { transactionHash };
    } catch (e) {
      throw new Error(e as string);
    }
  }

  /**
   * function to generate transfer proof for private burn and transfer
   * @param to recipient address
   * @param amount transfer amount
   * @param encryptedBalance encrypted balance
   * @param decryptedBalance decrypted balance
   * @param auditorPublicKey auditor public key
   * @returns proof and sender balance pct
   */
  private async generateTransferProof(
    to: string,
    amount: bigint,
    encryptedBalance: bigint[],
    decryptedBalance: bigint,
    auditorPublicKey: bigint[],
  ): Promise<{
    proof: eERC_Proof;
    senderBalancePCT: string[];
    receiverEncryptedAmount: string[];
    senderEncryptedAmount: string[];
  }> {
    try {
      if (auditorPublicKey[0] === 0n && auditorPublicKey[1] === 0n)
        throw new Error("Auditor is not set for the contract!");

      this.validateAddress(to);
      this.validateAmount(amount, decryptedBalance);

      const senderNewBalance = decryptedBalance - amount;
      const privateKey = formatKeyForCurve(this.decryptionKey);
      const receiverPublicKey = await this.fetchPublicKey(to);
      if (receiverPublicKey[0] === 0n && receiverPublicKey[1] === 0n)
        throw new Error("Receiver is not registered!");

      // 1. encrypt the transfer amount for sender
      const { cipher: encryptedAmountSender } = await this.curve.encryptMessage(
        this.publicKey as Point,
        amount,
      );

      // 2. encrypt the transfer amount for receiver
      const {
        cipher: encryptedAmountReceiver,
        random: encryptedAmountReceiverRandom,
      } = await this.curve.encryptMessage(receiverPublicKey as Point, amount);

      // 3. creates a pct for receiver with the transfer amount
      const {
        cipher: receiverCipherText,
        nonce: receiverPoseidonNonce,
        authKey: receiverAuthKey,
        encryptionRandom: receiverEncryptionRandom,
      } = await this.poseidon.processPoseidonEncryption({
        inputs: [amount],
        publicKey: receiverPublicKey as Point,
      });

      // 4. creates a pct for auditor with the transfer amount
      const {
        cipher: auditorCipherText,
        nonce: auditorPoseidonNonce,
        authKey: auditorAuthKey,
        encryptionRandom: auditorEncryptionRandom,
      } = await this.poseidon.processPoseidonEncryption({
        inputs: [amount],
        publicKey: auditorPublicKey as Point,
      });

      // 5. create pct for the sender with the new balance
      const {
        cipher: senderCipherText,
        nonce: senderPoseidonNonce,
        authKey: senderAuthKey,
      } = await this.poseidon.processPoseidonEncryption({
        inputs: [senderNewBalance],
        publicKey: this.publicKey as Point,
      });

      const input = {
        ValueToTransfer: amount,
        SenderPrivateKey: privateKey,
        SenderPublicKey: this.publicKey,
        SenderBalance: decryptedBalance,
        SenderBalanceC1: encryptedBalance.slice(0, 2),
        SenderBalanceC2: encryptedBalance.slice(2, 4),
        SenderVTTC1: encryptedAmountSender.c1,
        SenderVTTC2: encryptedAmountSender.c2,
        ReceiverPublicKey: receiverPublicKey,
        ReceiverVTTC1: encryptedAmountReceiver.c1,
        ReceiverVTTC2: encryptedAmountReceiver.c2,
        ReceiverVTTRandom: encryptedAmountReceiverRandom,
        ReceiverPCT: receiverCipherText,
        ReceiverPCTAuthKey: receiverAuthKey,
        ReceiverPCTNonce: receiverPoseidonNonce,
        ReceiverPCTRandom: receiverEncryptionRandom,

        AuditorPublicKey: auditorPublicKey,
        AuditorPCT: auditorCipherText,
        AuditorPCTAuthKey: auditorAuthKey,
        AuditorPCTNonce: auditorPoseidonNonce,
        AuditorPCTRandom: auditorEncryptionRandom,
      };

      // generate transfer proof
      const proof = await this.generateProof(input, "TRANSFER");

      // and also encrypts the amount of the transfer with sender public key for transaction history
      const {
        cipher: senderAmountCiphertext,
        nonce: senderAmountPoseidonNonce,
        authKey: senderAmountAuthKey,
      } = await this.poseidon.processPoseidonEncryption({
        inputs: [amount],
        publicKey: this.publicKey as Point,
      });

      return {
        proof,
        senderBalancePCT: [
          ...senderCipherText,
          ...senderAuthKey,
          senderPoseidonNonce,
        ].map(String),
        receiverEncryptedAmount: [
          ...receiverCipherText,
          ...receiverAuthKey,
          receiverPoseidonNonce,
        ].map(String),
        senderEncryptedAmount: [
          ...senderAmountCiphertext,
          ...senderAmountAuthKey,
          senderAmountPoseidonNonce,
        ].map(String),
      };
    } catch (e) {
      throw new Error(e as string);
    }
  }

  /**
   * function to fetch user public key from registrar contract
   * @param to user address
   * @returns user public key
   */
  async fetchPublicKey(to: string): Promise<Point> {
    if (to === BURN_USER.address) {
      return BURN_USER.publicKey as Point;
    }

    const publicKey = (await this.client.readContract({
      address: this.registrarAddress as `0x${string}`,
      abi: this.registrarAbi,
      functionName: "getUserPublicKey",
      args: [to],
    })) as Point;

    return publicKey as Point;
  }

  /**
   * function to fetch user approval from erc20 token
   * @param userAddress user address
   * @param tokenAddress token address
   * @returns user approval
   */
  async fetchUserApprove(userAddress: string, tokenAddress: string) {
    const data = await this.client.readContract({
      abi: erc20Abi,
      address: tokenAddress as `0x${string}`,
      functionName: "allowance",
      args: [userAddress as `0x${string}`, this.contractAddress],
    });

    return data;
  }

  /**
   * function to fetch token id from token address
   * @param tokenAddress token address
   * @returns token id
   */
  async fetchTokenId(tokenAddress: string) {
    const data = await this.client.readContract({
      abi: this.encryptedErcAbi,
      address: this.contractAddress as `0x${string}`,
      functionName: "tokenIds",
      args: [tokenAddress as `0x${string}`],
    });

    return data as bigint;
  }

  /**
   * function to calculate the total balance of the user by adding amount pcts with balance pct
   * at the end it decrypts the balance pct and compares it with the expected point make sure that balance is correct and
   * pcts are synced with el gamal cipher text
   * @param eGCT el gamal cipher text from contract
   * @param amountPCTs amount pct array
   * @param balancePCT balance pct array
   * @returns total balance
   */
  calculateTotalBalance(
    eGCT: EGCT,
    amountPCTs: AmountPCT[],
    balancePCT: bigint[],
  ) {
    const privateKey = formatKeyForCurve(this.decryptionKey);

    let totalBalance = 0n;

    if (balancePCT?.some((e) => e !== 0n)) {
      const decryptedBalancePCT = this.decryptPCT(balancePCT);
      totalBalance += decryptedBalancePCT;
    }

    for (let i = 0; i < amountPCTs.length; i++) {
      const amountPCT = amountPCTs[i];
      const decryptedPCT = this.decryptPCT(amountPCT.pct);
      totalBalance += decryptedPCT;
    }

    if (totalBalance !== 0n) {
      const decryptedEGCT = this.curve.elGamalDecryption(privateKey, {
        c1: [eGCT.c1.x, eGCT.c1.y],
        c2: [eGCT.c2.x, eGCT.c2.y],
      });
      const expectedPoint = this.curve.mulWithScalar(
        this.curve.Base8,
        totalBalance,
      );

      if (
        decryptedEGCT[0] !== expectedPoint[0] ||
        decryptedEGCT[1] !== expectedPoint[1]
      ) {
        return -1n;
      }
    }

    return totalBalance;
  }

  /**
   * function to decrypt the private message from the transaction logs
   * @param transactionHash transaction hash
   * @returns decrypted message
   */
  public async decryptMessage(transactionHash: string) {
    const tx = await this.client.getTransaction({
      hash: transactionHash as `0x${string}`,
    });

    const logs = await this.client.getLogs({
      event: {
        ...PRIVATE_MESSAGE_EVENT,
        type: "event",
      },
      address: this.contractAddress,
      fromBlock: tx.blockNumber,
      toBlock: tx.blockNumber,
    });

    if (!logs || logs.length === 0) {
      throw new Error("No private message found for this transaction");
    }

    const { encryptedMsg, messageType, messageFrom, messageTo } = (
      logs[0].args as {
        metadata: {
          encryptedMsg: string;
          messageType: string;
          messageFrom: `0x${string}`;
          messageTo: `0x${string}`;
        };
      }
    ).metadata;

    if (!encryptedMsg) {
      throw new Error("No encrypted message found in the transaction logs");
    }

    const privateKey = formatKeyForCurve(this.decryptionKey);
    const decryptedMessage = await decryptMetadata(
      this.poseidon,
      privateKey,
      encryptedMsg,
    );

    const metadata: DecryptedMetadata = {
      decryptedMessage,
      messageType,
      messageFrom,
      messageTo,
    };

    return metadata;
  }

  /**
   * function to perform poseidon decryption on the pct
   * @param pct pct array
   * @returns decrypted
   */
  public decryptPCT(pct: bigint[]) {
    const privateKey = formatKeyForCurve(this.decryptionKey);

    const cipher = pct.slice(0, 4) as bigint[];
    const authKey = pct.slice(4, 6) as Point;
    const nonce = pct[6] as bigint;
    const length = 1;

    const [amount] = this.poseidon.processPoseidonDecryption({
      privateKey,
      authKey,
      cipher,
      nonce,
      length,
    });

    return amount;
  }

  /**
   * @dev function checks if user has been auditor before from contract event logs
   */
  async hasBeenAuditor(): Promise<boolean> {
    const auditorChangedEvent = {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          internalType: "address",
          name: "oldAuditor",
          type: "address",
        },
        {
          indexed: true,
          internalType: "address",
          name: "newAuditor",
          type: "address",
        },
      ],
      name: "AuditorChanged",
    };

    type NamedEvents = Log & {
      eventName: string;
      args: {
        oldAuditor: `0x${string}`;
        newAuditor: `0x${string}`;
      };
    };

    const currentBlock = await this.client.getBlockNumber();
    const BOUND = 1000n;

    // Fetch logs where the user was the oldAuditor
    const logs = (await this.client.getLogs({
      address: this.contractAddress,
      event: { ...auditorChangedEvent, type: "event" },
      fromBlock: currentBlock > BOUND ? currentBlock - BOUND : 0n,
      toBlock: currentBlock,
    })) as NamedEvents[];

    // filter that only has oldAuditor and newAuditor is the user address
    const filteredLogs = logs.filter(
      (log) =>
        log.args.oldAuditor.toLowerCase() ===
          this.wallet.account?.address.toLowerCase() ||
        log.args.newAuditor.toLowerCase() ===
          this.wallet.account?.address.toLowerCase(),
    );

    let currentStart = null;

    for (const log of filteredLogs) {
      const { oldAuditor, newAuditor } = log.args;

      if (
        newAuditor.toLowerCase() === this.wallet?.account?.address.toLowerCase()
      ) {
        currentStart = log.blockNumber;
      } else if (
        oldAuditor.toLowerCase() ===
          this.wallet?.account?.address.toLowerCase() &&
        currentStart !== null
      ) {
        return true;
      }
    }

    if (currentStart !== null) {
      return true;
    }

    return false;
  }

  /**
   * function to decrypt the transactions of the auditor
   * @returns decrypted transactions
   *
   * @TODO: hasBeenAuditor?
   */
  async auditorDecrypt(): Promise<DecryptedTransaction[]> {
    if (!this.decryptionKey) throw new Error("Missing decryption key!");
    const isAuditor = await this.hasBeenAuditor();
    if (!isAuditor) {
      throw new Error("User is not an auditor");
    }

    type NamedEvents = Log & {
      eventName: string;
      args: { auditorPCT: bigint[] };
    };

    const result: (DecryptedTransaction & { blockNumber: bigint })[] = [];

    try {
      const currentBlock = await this.client.getBlockNumber();
      const BOUND = 1000n;

      logMessage("Fetching logs...");

      const logs: NamedEvents[] = [];
      for (const event of [
        PRIVATE_BURN_EVENT,
        PRIVATE_MINT_EVENT,
        PRIVATE_TRANSFER_EVENT,
      ]) {
        const fetchedLogs = (await this.client.getLogs({
          address: this.contractAddress,
          fromBlock: currentBlock > BOUND ? currentBlock - BOUND : 0n,
          toBlock: currentBlock,
          event: {
            ...event,
            type: "event",
          },
          args: {
            auditorAddress: this.wallet?.account?.address,
          },
        })) as NamedEvents[];

        logs.push(...fetchedLogs);
      }

      logMessage(`Fetched ${logs.length} logs from the contract`);

      for (const log of logs) {
        if (!log.transactionHash) continue;

        const tx = await this.client.getTransaction({
          hash: log.transactionHash,
        });

        const auditorPCT = log?.args?.auditorPCT as bigint[];
        if (!auditorPCT || auditorPCT?.length !== 7) continue;

        const decryptedAmount = this.decryptPCT(auditorPCT);
        const decodedInputs = decodeFunctionData({
          abi: this.encryptedErcAbi,
          data: tx.input,
        });

        result.push({
          transactionHash: log.transactionHash,
          amount: decryptedAmount.toString(),
          sender: tx.from,
          type: log.eventName.replace("Private", ""),
          receiver:
            decodedInputs?.functionName === "privateBurn"
              ? tx.to
              : (decodedInputs?.args?.[0] as `0x${string}`),
          blockNumber: tx.blockNumber,
        });
      }

      logMessage(`Transactions decrypted: ${result.length}`);

      // reverse the array to get the latest transactions first
      return result.sort(
        (a, b) => Number(b.blockNumber) - Number(a.blockNumber),
      ) as DecryptedTransaction[];
    } catch (e) {
      throw new Error(e as string);
    }
  }

  private convertTokenDecimals(
    amount: bigint,
    fromDecimals: number,
    toDecimals: number,
  ): bigint {
    try {
      if (fromDecimals === toDecimals) {
        return amount;
      }

      // decimal difference
      const diff = fromDecimals - toDecimals;

      let convertedAmount = 0n;
      if (diff > 0) {
        const scalingFactor = 10n ** BigInt(diff);
        convertedAmount = amount / scalingFactor;
      } else {
        const scalingFactor = 10n ** BigInt(Math.abs(diff));
        convertedAmount = amount * BigInt(scalingFactor);
      }

      return convertedAmount;
    } catch (e) {
      throw new Error(e as string);
    }
  }

  private async generateProof(
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    input: any,
    operation: "REGISTER" | "MINT" | "WITHDRAW" | "TRANSFER" | "BURN",
  ): Promise<eERC_Proof> {
    let wasm: string;
    let zkey: string;

    switch (operation) {
      case "REGISTER":
        wasm = this.circuitURLs.register.wasm;
        zkey = this.circuitURLs.register.zkey;
        break;
      case "MINT":
        wasm = this.circuitURLs.mint.wasm;
        zkey = this.circuitURLs.mint.zkey;
        break;
      case "WITHDRAW":
        wasm = this.circuitURLs.withdraw.wasm;
        zkey = this.circuitURLs.withdraw.zkey;
        break;
      case "TRANSFER":
        wasm = this.circuitURLs.transfer.wasm;
        zkey = this.circuitURLs.transfer.zkey;
        break;
      case "BURN":
        wasm = this.circuitURLs.burn.wasm;
        zkey = this.circuitURLs.burn.zkey;
        break;
      default:
        throw new Error("Invalid operation");
    }

    if (!wasm || !zkey) {
      throw new Error(
        `Missing ${!wasm ? "WASM" : "ZKey"} URL for ${operation} operation`,
      );
    }

    let wasmPath = "";
    let zkeyPath = "";

    // Check for Node.js environment
    const isBrowser =
      typeof window !== "undefined" && typeof window.document !== "undefined";
    const isNode = !isBrowser;

    if (isNode) {
      // Check if file exists locally
      const fs = await import("node:fs");
      if (fs.existsSync(wasm) && fs.existsSync(zkey)) {
        wasmPath = wasm;
        zkeyPath = zkey;
      }
    }

    if (!wasmPath || !zkeyPath) {
      const absoluteWasmURL = wasm.startsWith("/")
        ? new URL(wasm, import.meta.url)
        : new URL(wasm);

      const absoluteZkeyURL = zkey.startsWith("/")
        ? new URL(zkey, import.meta.url)
        : new URL(zkey);

      wasmPath = absoluteWasmURL.toString();
      zkeyPath = absoluteZkeyURL.toString();
    }

    const now = performance.now();
    const { proof: snarkProof, publicSignals } =
      await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);

    const rawCalldata = JSON.parse(
      `[${await snarkjs.groth16.exportSolidityCallData(
        snarkProof,
        publicSignals,
      )}]`,
    );

    const end = performance.now();
    logMessage(`Proof generation took ${(end - now).toFixed(2)}ms`);

    return {
      proofPoints: {
        a: rawCalldata[0],
        b: rawCalldata[1],
        c: rawCalldata[2],
      },
      publicSignals: rawCalldata[3],
    };
  }
}
