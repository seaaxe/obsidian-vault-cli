/**
 * write-binary — Write raw bytes to a vault file as a proper attachment.
 *
 * The plain `write` command stores content as a `type: "plain"` / `text/plain`
 * document, which is correct for notes but silently corrupts binary files:
 * stdin is collapsed to a JavaScript string via Buffer.toString("utf-8"),
 * replacing each invalid-UTF-8 byte with U+FFFD before the content even
 * reaches the LiveSync layer. This command bypasses both issues by reading
 * raw bytes and submitting them as a Blob with `application/octet-stream`,
 * which routes through the `"newnote"` attachment path inside
 * DirectFileManipulator.put.
 *
 * Usage: obsidian-vault write-binary <path> --input <file>
 *        cat photo.jpg | obsidian-vault write-binary Attachments/photo.jpg
 */

import fs from "node:fs";
import { Command, Args, Flags } from "@oclif/core";
import { createDFM } from "../lib/connection.ts";
import { createBinaryBlob } from "../../livesync-commonlib/src/common/utils.ts";

async function readStdinBytes(): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.on("data", chunk =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        );
        process.stdin.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
        process.stdin.on("error", reject);
    });
}

export default class WriteBinary extends Command {
    static description =
        "Write raw bytes to a vault file as a proper attachment (binary-safe, stored as type: newnote)";

    static examples = [
        '<%= config.bin %> write-binary "Attachments/photo.jpg" --input /tmp/photo.jpg',
        'cat local-file.pdf | <%= config.bin %> write-binary "Travel/ticket.pdf"',
    ];

    static args = {
        path: Args.string({
            description: "Vault-relative file path to write",
            required: true,
        }),
    };

    static flags = {
        input: Flags.string({
            char: "i",
            description:
                "Input file path — raw bytes read from here. Omit to read bytes from stdin.",
        }),
        verbose: Flags.boolean({
            char: "v",
            description: "Show verbose LiveSync log output",
            default: false,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(WriteBinary);

        let bytes: Uint8Array;
        if (flags.input) {
            if (!fs.existsSync(flags.input)) {
                this.error(`Input file not found: ${flags.input}`);
            }
            bytes = new Uint8Array(fs.readFileSync(flags.input));
        } else {
            if (process.stdin.isTTY) {
                this.error(
                    "No content provided. Pass --input <file> or pipe raw bytes via stdin."
                );
            }
            bytes = await readStdinBytes();
        }

        if (bytes.byteLength === 0) {
            this.error("Refusing to write an empty file.");
        }

        const dfm = await createDFM(flags.verbose);
        try {
            const now = Date.now();
            // createBinaryBlob tags the blob as application/octet-stream, which
            // makes isTextBlob() return false and routes dfm.put through the
            // "newnote" attachment storage path (base64-chunked body) rather
            // than the "plain" text path.
            const blob = createBinaryBlob(bytes);
            const ok = await dfm.put(
                args.path,
                blob,
                { ctime: now, mtime: now, size: bytes.byteLength },
                "newnote"
            );

            if (ok) {
                this.log(
                    `Written: ${args.path} (${bytes.byteLength} bytes, binary)`
                );
            } else {
                this.error(`Write returned false for: ${args.path}`);
            }
        } finally {
            await dfm.close();
            process.exit(0);
        }
    }
}
