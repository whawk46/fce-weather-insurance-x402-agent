export type TeePublicKey = {
  x: `0x${string}`;
  y: `0x${string}`;
};

export type TeeInfoResponse = {
  teeInfo: { publicKey: TeePublicKey };
  machineData: { publicKey: TeePublicKey };
  proxySignature: `0x${string}`;
};

export type ActionResultPayload = {
  data: `0x${string}`;
  id: `0x${string}`;
  submissionTag: string;
  status: number;
  log?: string;
};

export type ActionResponse = {
  result: ActionResultPayload;
  signature: `0x${string}`;
};
