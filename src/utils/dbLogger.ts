// import { prisma } from '~/server/db';

type Message = string | number | boolean | object | undefined | null | Error;

/** This method is only using console.log for now, but putting behind a
this interface will make it easier to switch to a different logging
library later. */
const logger = {
	debug: (...message: Message[]) => logMessage("DEBUG", message),
	info: (...message: Message[]) => logMessage("INFO", message),
	warning: (...message: Message[]) => logMessage("WARNING", message),
	error: (...message: Message[]) => logMessage("ERROR", message),
};

const logMessage = (
	level: "DEBUG" | "INFO" | "WARNING" | "ERROR",
	// one or more messages
	...messages: Message[]
) => {
	switch (level) {
		case "DEBUG":
			console.debug(...messages);
			break;
		case "INFO":
			console.info(...messages);
			break;
		case "WARNING":
			console.warn(...messages);
			break;
		case "ERROR":
			console.error(...messages);
			break;
	}
};

export default logger;
