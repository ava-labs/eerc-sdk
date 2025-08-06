export const SNARK_FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const SHA_256_MAX_DIGEST =
  115792089237316195423570985008687907853269984665640564039457584007913129639936n;
export const SUB_GROUP_ORDER =
  2736030358979909402780800718157159386076813972158567259200215660948447373041n;

export const MESSAGES = {
  REGISTER: (user: string) =>
    `eERC\nRegistering user with\n Address:${user.toLowerCase()}`,
};

// burn user is used for private burn transactions
// instead of burning tokens, they are transferred to the burn user in the standalone version
export const BURN_USER = {
  address: "0x1111111111111111111111111111111111111111",
  publicKey: [0n, 1n],
};

export const PRIVATE_TRANSFER_EVENT = {
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: "address",
      name: "from",
      type: "address",
    },
    {
      indexed: true,
      internalType: "address",
      name: "to",
      type: "address",
    },
    {
      indexed: false,
      internalType: "uint256[7]",
      name: "auditorPCT",
      type: "uint256[7]",
    },
    {
      indexed: true,
      internalType: "address",
      name: "auditorAddress",
      type: "address",
    },
  ],
  name: "PrivateTransfer",
  type: "event",
};

export const PRIVATE_MINT_EVENT = {
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: "address",
      name: "user",
      type: "address",
    },
    {
      indexed: false,
      internalType: "uint256[7]",
      name: "auditorPCT",
      type: "uint256[7]",
    },
    {
      indexed: true,
      internalType: "address",
      name: "auditorAddress",
      type: "address",
    },
  ],
  name: "PrivateMint",
  type: "event",
};

export const PRIVATE_BURN_EVENT = {
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: "address",
      name: "user",
      type: "address",
    },
    {
      indexed: false,
      internalType: "uint256[7]",
      name: "auditorPCT",
      type: "uint256[7]",
    },
    {
      indexed: true,
      internalType: "address",
      name: "auditorAddress",
      type: "address",
    },
  ],
  name: "PrivateBurn",
  type: "event",
};

export const PRIVATE_MESSAGE_EVENT = {
  anonymous: false,
  inputs: [
    {
      indexed: true,
      internalType: "address",
      name: "from",
      type: "address",
    },
    {
      indexed: true,
      internalType: "address",
      name: "to",
      type: "address",
    },
    {
      components: [
        {
          internalType: "address",
          name: "messageFrom",
          type: "address",
        },
        {
          internalType: "address",
          name: "messageTo",
          type: "address",
        },
        {
          internalType: "string",
          name: "messageType",
          type: "string",
        },
        {
          internalType: "bytes",
          name: "encryptedMsg",
          type: "bytes",
        },
      ],
      indexed: false,
      internalType: "struct Metadata",
      name: "metadata",
      type: "tuple",
    },
  ],
  name: "PrivateMessage",
  type: "event",
};

export const PRIVATE_MINT_WITH_MESSAGE_ABI = [
  {
    inputs: [
      {
        internalType: "address",
        name: "user",
        type: "address",
      },
      {
        components: [
          {
            components: [
              {
                internalType: "uint256[2]",
                name: "a",
                type: "uint256[2]",
              },
              {
                internalType: "uint256[2][2]",
                name: "b",
                type: "uint256[2][2]",
              },
              {
                internalType: "uint256[2]",
                name: "c",
                type: "uint256[2]",
              },
            ],
            internalType: "struct ProofPoints",
            name: "proofPoints",
            type: "tuple",
          },
          {
            internalType: "uint256[24]",
            name: "publicSignals",
            type: "uint256[24]",
          },
        ],
        internalType: "struct MintProof",
        name: "proof",
        type: "tuple",
      },
      {
        internalType: "bytes",
        name: "message",
        type: "bytes",
      },
    ],
    name: "privateMint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

export const TRANSFER_WITH_MESSAGE_ABI = [
  {
    inputs: [
      {
        internalType: "address",
        name: "to",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "tokenId",
        type: "uint256",
      },
      {
        components: [
          {
            components: [
              {
                internalType: "uint256[2]",
                name: "a",
                type: "uint256[2]",
              },
              {
                internalType: "uint256[2][2]",
                name: "b",
                type: "uint256[2][2]",
              },
              {
                internalType: "uint256[2]",
                name: "c",
                type: "uint256[2]",
              },
            ],
            internalType: "struct ProofPoints",
            name: "proofPoints",
            type: "tuple",
          },
          {
            internalType: "uint256[32]",
            name: "publicSignals",
            type: "uint256[32]",
          },
        ],
        internalType: "struct TransferProof",
        name: "proof",
        type: "tuple",
      },
      {
        internalType: "uint256[7]",
        name: "balancePCT",
        type: "uint256[7]",
      },
      {
        internalType: "bytes",
        name: "message",
        type: "bytes",
      },
    ],
    name: "transfer",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

export const DEPOSIT_WITH_MESSAGE_ABI = [
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "tokenAddress",
        type: "address",
      },
      {
        internalType: "uint256[7]",
        name: "amountPCT",
        type: "uint256[7]",
      },
      {
        internalType: "bytes",
        name: "message",
        type: "bytes",
      },
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

export const WITHDRAW_WITH_MESSAGE_ABI = [
  {
    inputs: [
      {
        internalType: "uint256",
        name: "tokenId",
        type: "uint256",
      },
      {
        components: [
          {
            components: [
              {
                internalType: "uint256[2]",
                name: "a",
                type: "uint256[2]",
              },
              {
                internalType: "uint256[2][2]",
                name: "b",
                type: "uint256[2][2]",
              },
              {
                internalType: "uint256[2]",
                name: "c",
                type: "uint256[2]",
              },
            ],
            internalType: "struct ProofPoints",
            name: "proofPoints",
            type: "tuple",
          },
          {
            internalType: "uint256[16]",
            name: "publicSignals",
            type: "uint256[16]",
          },
        ],
        internalType: "struct WithdrawProof",
        name: "proof",
        type: "tuple",
      },
      {
        internalType: "uint256[7]",
        name: "balancePCT",
        type: "uint256[7]",
      },
      {
        internalType: "bytes",
        name: "message",
        type: "bytes",
      },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

export const PRIVATE_BURN_ABI = [
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: "uint256[2]",
                name: "a",
                type: "uint256[2]",
              },
              {
                internalType: "uint256[2][2]",
                name: "b",
                type: "uint256[2][2]",
              },
              {
                internalType: "uint256[2]",
                name: "c",
                type: "uint256[2]",
              },
            ],
            internalType: "struct ProofPoints",
            name: "proofPoints",
            type: "tuple",
          },
          {
            internalType: "uint256[19]",
            name: "publicSignals",
            type: "uint256[19]",
          },
        ],
        internalType: "struct BurnProof",
        name: "proof",
        type: "tuple",
      },
      {
        internalType: "uint256[7]",
        name: "balancePCT",
        type: "uint256[7]",
      },
    ],
    name: "privateBurn",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];
