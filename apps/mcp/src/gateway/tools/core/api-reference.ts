import { createStandardApiReference, type ApiReference } from "@univer-cli/api-reference";

let reference: ApiReference | undefined;
/** The bundled Facade API index loads on first use and is shared by every request. */
export const apiReference = (): ApiReference => (reference ??= createStandardApiReference());
