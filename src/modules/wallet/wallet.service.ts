import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { SigningKey } from '@ethersproject/signing-key';
import { keccak256 } from '@ethersproject/keccak256';
import * as crypto from 'crypto';
import axios from 'axios';

/**
 * WalletService - Handles Tron HD wallet operations
 *
 * HD (Hierarchical Deterministic) Wallet:
 * - One master seed generates unlimited addresses
 * - Each address is derived using a path: m/44'/195'/0'/0/{index}
 * - Same seed + same path = same address (deterministic)
 */
@Injectable()
export class WalletService {
  // Tron uses the same derivation as Ethereum but with Tron's coin type
  // BIP44 path: m/purpose'/coin_type'/account'/change/address_index
  // 44' = BIP44 standard
  // 195' = Tron coin type
  // 0' = first account
  // 0 = external chain (not change addresses)
  private readonly DERIVATION_PATH = "m/44'/195'/0'/0";

  private tronRpcUrl: string;
  private tronApiKeys: string[];
  private currentApiKeyIndex = 0;

  // USDT TRC20 contract address (mainnet)
  private readonly USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  private readonly USDT_DECIMALS = 6;

  constructor(private configService: ConfigService) {
    this.tronRpcUrl = this.configService.get('TRON_RPC_URL', 'https://api.trongrid.io');
    const key1 = this.configService.get('TRON_API_KEY');
    const key2 = this.configService.get('TRON_API_KEY_2');
    const key3 = this.configService.get('TRON_API_KEY_3');
    this.tronApiKeys = [key1, key2, key3].filter(Boolean);
  }

  /**
   * Get next API key for rate limit rotation
   */
  private getNextApiKey(): string {
    if (this.tronApiKeys.length === 0) return '';
    const key = this.tronApiKeys[this.currentApiKeyIndex];
    this.currentApiKeyIndex = (this.currentApiKeyIndex + 1) % this.tronApiKeys.length;
    return key;
  }

  /**
   * Convert private key to Tron address
   * Tron uses same elliptic curve as Ethereum (secp256k1)
   *
   */
  private privateKeyToAddress(privateKeyHex: string): string {
    // Step 1: Get public key from private key
    const signingKey = new SigningKey('0x' + privateKeyHex);
    const publicKey = signingKey.publicKey; // Returns uncompressed public key with 0x04 prefix

    // Step 2: Get ethereum-style address (keccak256 of public key, last 20 bytes)
    const publicKeyBytes = Buffer.from(publicKey.slice(4), 'hex'); // Remove 0x04 prefix
    const hash = keccak256(publicKeyBytes);
    const addressBytes = Buffer.from(hash.slice(-40), 'hex'); // Last 20 bytes

    // Step 3: Add Tron prefix (0x41 = mainnet)
    const tronPrefix = Buffer.from([0x41]);
    const addressWithPrefix = Buffer.concat([tronPrefix, addressBytes]);

    // Step 4: Double SHA256 for checksum
    const hash1 = crypto
      .createHash('sha256')
      .update(addressWithPrefix)
      .digest();
    const hash2 = crypto.createHash('sha256').update(hash1).digest();
    const checksum = hash2.slice(0, 4);

    // Step 5: Concatenate address + checksum and base58 encode
    const addressWithChecksum = Buffer.concat([addressWithPrefix, checksum]);

    // Base58 encode
    return this.base58Encode(addressWithChecksum);
  }

  /**
   * Base58 encoding (Bitcoin/Tron style)
   */
  private base58Encode(buffer: Buffer): string {
    const ALPHABET =
      '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const digits = [0];

    for (let i = 0; i < buffer.length; i++) {
      let carry = buffer[i];
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }

    // Add leading zeros
    for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
      digits.push(0);
    }

    return digits
      .reverse()
      .map((digit) => ALPHABET[digit])
      .join('');
  }

  /**
   * Generate a new mnemonic phrase
   *
   * @param wordCount - 12 or 24 words (default: 12)
   * @returns A mnemonic phrase (12 or 24 words)
   */
  generateMnemonic(wordCount: 12 | 24 = 12): string {
    // 12 words = 128 bits of entropy
    // 24 words = 256 bits of entropy
    const strength = wordCount === 12 ? 128 : 256;
    return bip39.generateMnemonic(strength);
  }

  /**
   * Validate a mnemonic phrase
   *
   * @param mnemonic - The mnemonic to validate
   * @returns true if valid, false otherwise
   */
  validateMnemonic(mnemonic: string): boolean {
    return bip39.validateMnemonic(mnemonic);
  }

  /**
   * Derive a Tron address from mnemonic at a specific index
   *
   * @param mnemonic - The master mnemonic phrase
   * @param index - The derivation index (0, 1, 2, ...)
   * @returns Object with address and private key
   */
  deriveAddress(mnemonic: string, index: number): TronAddress {
    // Step 1: Convert mnemonic to seed (512-bit)
    const seed = bip39.mnemonicToSeedSync(mnemonic);

    // Step 2: Create BIP32 instance with elliptic curve cryptography
    const bip32 = BIP32Factory(ecc);

    // Step 3: Create master key from seed
    const root = bip32.fromSeed(seed);

    // Step 4: Derive child key at specific path
    // Example: m/44'/195'/0'/0/0 (first address)
    //          m/44'/195'/0'/0/1 (second address)
    const path = `${this.DERIVATION_PATH}/${index}`;
    const child = root.derivePath(path);

    // Step 5: Get private key from derived child
    if (!child.privateKey) {
      throw new Error('Failed to derive private key');
    }

    const privateKey = Buffer.from(child.privateKey).toString('hex');

    // Step 6: Generate Tron address from private key
    const address = this.privateKeyToAddress(privateKey);

    return {
      address,
      privateKey,
      derivationPath: path,
      index,
    };
  }

  /**
   * Get address from private key only
   * Useful when you have the private key but need the address
   *
   * @param privateKey - Hex encoded private key
   * @returns Tron address
   */
  getAddressFromPrivateKey(privateKey: string): string {
    return this.privateKeyToAddress(privateKey);
  }

  /**
   * Validate a Tron address format
   *
   * @param address - Address to validate
   * @returns true if valid Tron address
   */
  isValidAddress(address: string): boolean {
    // Basic validation: Tron mainnet addresses start with 'T' and are 34 chars
    return address.length === 34 && address.startsWith('T');
  }

  /**
   * Convert Tron address to hex format
   * Tron uses base58 format (starts with T), but sometimes you need hex
   *
   * @param address - Base58 Tron address
   * @returns Hex address
   */
  toHexAddress(address: string): string {
    // Decode base58 and remove prefix + checksum
    const decoded = this.base58Decode(address);
    // Remove Tron prefix (0x41) and checksum (last 4 bytes)
    return '0x' + decoded.slice(1, 21).toString('hex');
  }

  /**
   * Base58 decoding
   */
  private base58Decode(str: string): Buffer {
    const ALPHABET =
      '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const bytes = [0];

    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      const value = ALPHABET.indexOf(c);
      if (value === -1) throw new Error('Invalid base58 character');

      let carry = value;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }

    // Add leading zeros
    for (let i = 0; i < str.length && str[i] === '1'; i++) {
      bytes.push(0);
    }

    return Buffer.from(bytes.reverse());
  }

  /**
   * Get master public key for watch-only wallets
   * This allows generating addresses without exposing private keys
   *
   * @param mnemonic - The master mnemonic
   * @returns Extended public key (xpub)
   */
  getMasterPublicKey(mnemonic: string): string {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const bip32 = BIP32Factory(ecc);
    const root = bip32.fromSeed(seed);
    const masterNode = root.derivePath(this.DERIVATION_PATH);

    return masterNode.neutered().toBase58(); // neutered() removes private key
  }

}

/**
 * Interface for Tron address information
 */
export interface TronAddress {
  address: string; // Base58 Tron address (starts with T)
  privateKey: string; // Hex encoded private key
  derivationPath: string; // BIP44 derivation path used
  index: number; // Address index
}

