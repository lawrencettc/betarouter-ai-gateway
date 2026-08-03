"use client";
import { loadStripe } from "@stripe/stripe-js/pure";
import { useEffect, useState } from "react";

import { useAppConfig } from "@/lib/config";

import type { Stripe } from "@stripe/stripe-js";

let stripePromise: Promise<Stripe | null> | null = null;

function getStripePromise(publishableKey: string) {
	stripePromise ??= loadStripe(publishableKey);
	return stripePromise;
}

export function useStripe() {
	const { stripePublishableKey } = useAppConfig();
	const [stripe, setStripe] = useState<Stripe | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);

	useEffect(() => {
		if (!stripePublishableKey) {
			setError(new Error("STRIPE_PUBLISHABLE_KEY is not configured"));
			setIsLoading(false);
			return;
		}

		getStripePromise(stripePublishableKey)
			.then((stripeInstance) => {
				setStripe(stripeInstance);
				setIsLoading(false);
			})
			.catch((err) => {
				setError(err);
				setIsLoading(false);
			});
	}, [stripePublishableKey]);

	return { stripe, isLoading, error };
}
