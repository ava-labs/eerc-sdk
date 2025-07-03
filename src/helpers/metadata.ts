import { pad, toHex, concat } from "viem";
import type { Poseidon } from "../crypto/poseidon";
import type { Point } from "../crypto/types";

// Function to split a BigInt into 250-bit chunks
function splitIntoBigIntChunks(decimal: string): bigint[] {
  const bigIntDecimal = BigInt(decimal);
  const chunks: bigint[] = [];

  // 2^250 as a BigInt
  const chunkSize = BigInt(2) ** BigInt(250);

  if (bigIntDecimal === BigInt(0)) {
    return [BigInt(0)];
  }

  let remaining = bigIntDecimal;
  while (remaining > BigInt(0)) {
    chunks.push(remaining % chunkSize);
    remaining = remaining / chunkSize;
  }

  return chunks;
}

// Function to combine BigInt chunks back into a single decimal string
function combineFromBigIntChunks(chunks: bigint[]): bigint {
  // 2^250 as a BigInt
  const chunkSize = BigInt(2) ** BigInt(250);

  let result = BigInt(0);
  for (let i = chunks.length - 1; i >= 0; i--) {
    result = result * chunkSize + (chunks[i] as bigint);
  }

  return result;
}

/**
 * Convert a UTF-8 string into a big integer by interpreting its bytes as a base-256 number.
 */
export function str2int(s: string): [bigint[], bigint] {
  // Handle empty string case
  if (s === "") {
    return [[BigInt(0)], BigInt(1)];
  }

  // in browsers use TextEncoder
  const buf = Buffer.from(s, "utf8");
  const hexString = buf.toString("hex");
  // Add check for empty hex string
  const result = hexString === "" ? BigInt(0) : BigInt(`0x${hexString}`);
  const resultChunks = splitIntoBigIntChunks(result.toString());

  return [resultChunks, BigInt(resultChunks.length)];
}

/**
 * Convert a big integer back into a UTF-8 string by reversing the above process.
 */
export function int2str(input: bigint[]): string {
  // Special case for empty string
  if (input.length === 1 && input[0] === BigInt(0)) {
    return "";
  }

  const decimal = combineFromBigIntChunks(input);

  // Return empty string if the decimal is 0
  if (decimal === 0n) {
    return "";
  }

  let hex = decimal.toString(16);
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`;
  }
  const buf = Buffer.from(hex, "hex");

  // Remove null characters from the result
  // biome-ignore lint/suspicious/noControlCharactersInRegex: We need to remove null characters from the result
  return buf.toString("utf8").replace(/\u0000/g, "");
}

// uses poseidon ecdh encryption to encrypt the message, just like PCTs but ciphertext is added to the bottom of the message
// after the message is encrypted, it is converted to bytes
export const encryptMetadata = async (
  poseidon: Poseidon,
  publicKey: bigint[],
  message: string,
): Promise<string> => {
  const [messageFieldElements, length] = str2int(message);

  const {
    cipher: metadataCiphertext,
    nonce: metadataNonce,
    authKey: metadataAuthKey,
  }: {
    cipher: bigint[];
    nonce: bigint;
    authKey: Point;
  } = await poseidon.processPoseidonEncryption({
    inputs: messageFieldElements as bigint[],
    publicKey: publicKey as Point,
  });

  const componentsToConcat = [
    pad(toHex(length), { size: 32 }), // length (1 * 32 bytes)
    pad(toHex(metadataNonce), { size: 32 }), // nonce (1 * 32 bytes)
    pad(toHex(metadataAuthKey[0]), { size: 32 }), // authKey[0] (1 * 32 bytes)
    pad(toHex(metadataAuthKey[1]), { size: 32 }), // authKey[1] (1 * 32 bytes)
    ...metadataCiphertext.map((chunk) => pad(toHex(chunk), { size: 32 })),
  ];

  const encryptedMessageBytes = concat(componentsToConcat);

  return encryptedMessageBytes;
};

// export const decryptMetadata = (
//   privateKey: bigint,
//   encryptedMessage: string,
// ): string => {
//   const hexData = encryptedMessage.startsWith("0x")
//     ? encryptedMessage.slice(2)
//     : encryptedMessage;

//   const lengthHex = `0x${hexData.slice(0, 64)}`;
//   const nonceHex = `0x${hexData.slice(64, 128)}`;
//   const authKey0Hex = `0x${hexData.slice(128, 192)}`;
//   const authKey1Hex = `0x${hexData.slice(192, 256)}`;

//   const length = BigInt(lengthHex);
//   const nonce = BigInt(nonceHex);
//   const authKey: [bigint, bigint] = [BigInt(authKey0Hex), BigInt(authKey1Hex)];

//   const ciphertextHex = hexData.slice(256);
//   const ciphertext: bigint[] = [];

//   for (let i = 0; i < ciphertextHex.length; i += 64) {
//     const chunkHex = `0x${ciphertextHex.slice(i, i + 64)}`;
//     ciphertext.push(BigInt(chunkHex));
//   }

//   const decryptedFieldElements = processPoseidonDecryption(
//     ciphertext,
//     authKey,
//     nonce,
//     privateKey,
//     Number(length),
//   );

//   return int2str(decryptedFieldElements);
// };
