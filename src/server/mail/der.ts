/** DER length bytes, for the two places that wrap RSA keys by hand. */
export function derLength(n: number): number[] {
    if (n < 128) return [n];
    const bytes: number[] = [];
    while (n > 0) {
        bytes.unshift(n & 0xff);
        n >>= 8;
    }
    return [0x80 | bytes.length, ...bytes];
}

/** AlgorithmIdentifier for rsaEncryption with NULL parameters. */
export const RSA_ALGORITHM = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
