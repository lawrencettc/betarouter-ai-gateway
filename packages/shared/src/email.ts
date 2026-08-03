import { Resend } from "resend";

const resendApiKey = process.env.RESEND_API_KEY;
const fromEmail =
	process.env.RESEND_FROM_EMAIL ?? "betarouter <hello@betarouter.com>";
const replyToEmail =
	process.env.RESEND_REPLY_TO_EMAIL ?? "contact@betarouter.com";
const resendAudienceId = process.env.RESEND_AUDIENCE_ID ?? "";

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
	if (!resendApiKey) {
		return null;
	}
	resendClient ??= new Resend(resendApiKey);
	return resendClient;
}

export { fromEmail, replyToEmail, resendAudienceId, getResendClient };
