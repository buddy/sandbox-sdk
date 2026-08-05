export const REGIONS = {
	US: "US",
	EU: "EU",
	AS: "AS",
} as const;

export type Region = (typeof REGIONS)[keyof typeof REGIONS];

export const API_URLS: Record<Region, string> = {
	US: "https://api.buddy.works",
	EU: "https://api.eu.buddy.works",
	AS: "https://api.asia.buddy.works",
};

export function getApiUrlFromRegion(region: Region): string {
	return API_URLS[region];
}

export function parseRegion(input: string | undefined): Region {
	if (!input) return REGIONS.US;

	const normalized = input.toUpperCase().trim();
	const region = REGIONS[normalized as Region];

	if (region) return region;

	throw new Error(
		`Invalid region: "${input}". Valid regions are: ${Object.keys(REGIONS).join(", ")}`,
	);
}
