import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * EncryptionService - Handles encryption/decryption of sensitive data
 *
 * Uses AES-256-GCM (Galois/Counter Mode) which provides:
 * - Strong encryption (AES-256)
 * - Authentication (verifies data hasn't been tampered with)
 * - Built into Node.js crypto module
 */
@Injectable()
export class EncryptionService {
  // AES-256 requires a 32-byte key
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly KEY_LENGTH = 32;
  private readonly IV_LENGTH = 16; // Initialization Vector
  private readonly SALT_LENGTH = 32;
  private readonly TAG_LENGTH = 16; // Authentication tag

  /**
   * Encrypt a mnemonic seed phrase
   *
   * @param plaintext - The mnemonic phrase to encrypt
   * @param password - Master password (from environment variable)
   * @returns Encrypted data with IV, salt, and auth tag
   */
  encrypt(plaintext: string, password: string): EncryptedData {
    // Generate random salt for key derivation
    // Salt prevents rainbow table attacks
    const salt = crypto.randomBytes(this.SALT_LENGTH);

    // Derive encryption key from password using PBKDF2
    // 100,000 iterations makes brute force attacks expensive
    const key = crypto.pbkdf2Sync(
      password,
      salt,
      100000, // iterations
      this.KEY_LENGTH,
      'sha256',
    );

    // Generate random IV (Initialization Vector)
    // IV ensures same plaintext produces different ciphertext each time
    const iv = crypto.randomBytes(this.IV_LENGTH);

    // Create cipher
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

    // Encrypt the data
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    // Get authentication tag
    // This verifies the data hasn't been tampered with
    const authTag = cipher.getAuthTag();

    return {
      encrypted: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      salt: salt.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  /**
   * Decrypt an encrypted mnemonic seed phrase
   *
   * @param encryptedData - The encrypted data object
   * @param password - Master password (same one used for encryption)
   * @returns Decrypted mnemonic phrase
   */
  decrypt(encryptedData: EncryptedData, password: string): string {
    // Convert hex strings back to buffers
    const salt = Buffer.from(encryptedData.salt, 'hex');
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const authTag = Buffer.from(encryptedData.authTag, 'hex');
    const encrypted = Buffer.from(encryptedData.encrypted, 'hex');

    // Derive the same key using the stored salt
    const key = crypto.pbkdf2Sync(
      password,
      salt,
      100000,
      this.KEY_LENGTH,
      'sha256',
    );

    // Create decipher
    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);

    // Set authentication tag
    decipher.setAuthTag(authTag);

    // Decrypt the data
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  /**
   * Generate a random encryption password
   * Useful for testing or generating new master passwords
   */
  generatePassword(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }
}

/**
 * Structure of encrypted data
 * All values are hex-encoded strings for easy storage
 */
export interface EncryptedData {
  encrypted: string; // The encrypted mnemonic
  iv: string; // Initialization vector
  salt: string; // Salt used for key derivation
  authTag: string; // Authentication tag for verification
}
