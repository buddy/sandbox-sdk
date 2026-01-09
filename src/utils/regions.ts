export const REGIONS = {
	US: "US",
	EU: "EU",
	AP: "AP",
} as const;

export type Region = (typeof REGIONS)[keyof typeof REGIONS];

export const API_URLS: Record<Region, string> = {
	US: "https://api.buddy.works",
	EU: "https://api.eu.buddy.works",
	AP: "https://api.asia.buddy.works",
};

export function getApiUrlFromRegion(region: Region): string {
	return API_URLS[region];
}

export function parseRegion(input: string | undefined): Region {
	if (!input) return REGIONS.US;

	const normalized = input.toUpperCase().trim();

	if (normalized === "US" || normalized === "EU" || normalized === "AP") {
		return normalized as Region;
	}

	throw new Error(`Invalid region: "${input}". Valid regions are: US, EU, AP`);
}
