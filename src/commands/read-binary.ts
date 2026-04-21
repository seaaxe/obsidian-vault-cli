/**
 * read-binary — Decrypt a vault file and write raw bytes to an output file.
 *
 * Unlike `read`, this command handles binary attachments (PDFs, images, etc.)
 * correctly by writing the reassembled bytes to a file rather than joining
 * chunks as a UTF-8 string. Safe for text files too (just writes the text
 * bytes to the file).
 *
 * Usage: obsidian-vault read-binary <path> --output <file>
 */

import fs from "node:fs";
import { Command, Args, Flags } from "@oclif/core";
import { createDFM, listFiles } from "../lib/connection.ts";
import { readAsBlob } from "../../livesync-commonlib/src/common/utils.ts";

export default class ReadBinary extends Command {
    static description = "Decrypt a vault file and write raw bytes to --output (binary-safe)";

    static examples = [
        '<%= config.bin %> read-binary "Travel/SQ123-ticket.pdf" --output /tmp/ticket.pdf',
        '<%= config.bin %> read-binary "Attachments/photo.jpg" -o /tmp/photo.jpg',
    ];

    static args = {
        path: Args.string({
            description: "Vault-relative file path",
            required: true,
        }),
    };

    static flags = {
        output: Flags.string({
            char: "o",
            description: "Output file path — raw bytes will be written here",
            required: true,
        }),
        verbose: Flags.boolean({
            char: "v",
            description: "Show verbose LiveSync log output",
            default: false,
        }),
        "by-id": Flags.boolean({
            description: "Treat <path> as a CouchDB document ID rather than file path",
            default: false,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ReadBinary);

        const dfm = await createDFM(flags.verbose);
        try {
            let doc: any;
            if (flags["by-id"]) {
                doc = await dfm.getById(args.path as any);
            } else {
                doc = await dfm.get(args.path as any);
                if (!doc || !("data" in doc)) {
                    // Fall back to case-insensitive path match (same behaviour as read.ts).
                    const files = await listFiles(dfm);
                    const match = files.find(f =>
                        f.path === args.path ||
                        f.path.toLowerCase() === args.path.toLowerCase()
                    );
                    if (!match) this.error(`File not found: ${args.path}`);
                    doc = await dfm.getById(match.id);
                }
            }

            if (!doc || !("data" in doc)) {
                this.error(`Could not read file: ${args.path}`);
            }

            // readAsBlob handles both "plain" (text) and "newnote" (binary) docs.
            // For binary: chunks are base64-decoded and concatenated via decodeBinary.
            // For text: chunks are joined as UTF-8. Either way we end up with a Blob
            // whose bytes are the correct file contents.
            const blob = readAsBlob(doc);
            const bytes = new Uint8Array(await blob.arrayBuffer());
            fs.writeFileSync(flags.output, bytes);
        } finally {
            await dfm.close();
            process.exit(0);
        }
    }
}
