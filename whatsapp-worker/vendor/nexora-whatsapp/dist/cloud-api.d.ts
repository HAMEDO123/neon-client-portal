export type WhatsAppCloudCredentials = {
    phoneNumberId: string;
    businessAccountId: string;
    accessToken: string;
    appSecret: string | null;
};
export declare function verifyWhatsAppCloudCredentials(creds: Pick<WhatsAppCloudCredentials, "phoneNumberId" | "accessToken">): Promise<{
    ok: true;
    displayPhoneNumber: string;
    verifiedName: string;
} | {
    ok: false;
    error: string;
}>;
export declare function sendWhatsAppCloudMessage(creds: WhatsAppCloudCredentials, to: string, text: string): Promise<void>;
export declare function sendWhatsAppCloudTypingIndicator(creds: WhatsAppCloudCredentials, messageId: string): Promise<void>;
export declare function downloadWhatsAppMedia(creds: WhatsAppCloudCredentials, mediaId: string): Promise<{
    buffer: Buffer;
    mimeType: string;
}>;
export declare function sendWhatsAppCloudVoiceMessage(creds: WhatsAppCloudCredentials, to: string, audio: Buffer, mimeType?: string): Promise<void>;
export declare function sendWhatsAppCloudMediaMessage(creds: WhatsAppCloudCredentials, to: string, fileUrl: string, mimeType: string, filename: string): Promise<void>;
export declare function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean;
//# sourceMappingURL=cloud-api.d.ts.map