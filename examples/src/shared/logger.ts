function log(message: string): void {
	if (message.startsWith("\n")) {
		console.log(`\n= ${message.slice(1)}`);
	} else {
		console.log(`= ${message}`);
	}
}

export { log };
