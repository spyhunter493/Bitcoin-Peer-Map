import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const specification = new URL('../../src/server/openapi.json', import.meta.url);
let output = new URL('../../src/shared/api.generated.d.ts', import.meta.url);
const arguments_ = process.argv.slice(2);
let check = false;
for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (argument === '--check') check = true;
    else if (argument === '--output' && arguments_[index + 1]) output = pathToFileURL(resolve(arguments_[++index]));
    else throw new Error('Supported arguments: --check and --output <path>');
}
const declarations = '// Generated from src/server/openapi.json. Run npm run generate:api; do not edit.\n'
    + astToString(await openapiTS(specification, { rootTypes: true, rootTypesNoSchemaPrefix: true }));
if (check) {
    const existing = await readFile(output, 'utf8').catch(() => '');
    if (existing !== declarations) {
        console.error('API declarations are out of date. Run npm run generate:api and commit the result.');
        process.exitCode = 1;
    } else console.log('API declarations match OpenAPI');
} else {
    await mkdir(dirname(fileURLToPath(output)), { recursive: true });
    await writeFile(output, declarations);
    console.log('Generated src/shared/api.generated.d.ts');
}
