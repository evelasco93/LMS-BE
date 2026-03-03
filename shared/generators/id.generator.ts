import { EntityPrefix } from "../enums/entity-prefix.enum";

export class IdGenerator {
  private static readonly CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  private static readonly DIGITS = "0123456789";
  private static readonly DEFAULT_LENGTH = 8;

  /**
   * Generate a unique ID with optional prefix
   * @param prefix - Optional entity prefix (e.g., 'CL' for client)
   * @param length - Total length of ID excluding prefix (default: 8)
   * @returns Uppercase ID string
   */
  static generate(
    prefix?: EntityPrefix | string,
    length: number = IdGenerator.DEFAULT_LENGTH,
  ): string {
    const randomPart = IdGenerator.generateRandomString(length);

    if (prefix) {
      return `${prefix}${randomPart}`;
    }

    return randomPart;
  }

  /**
   * Generate random alphanumeric string
   * @param length - Length of string to generate
   * @returns Uppercase random string
   */
  private static generateRandomString(length: number): string {
    let result = "";
    const charsLength = IdGenerator.CHARS.length;

    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * charsLength);
      result += IdGenerator.CHARS[randomIndex];
    }

    return result;
  }

  private static generateRandomDigits(length: number): string {
    let result = "";
    const digitsLength = IdGenerator.DIGITS.length;

    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * digitsLength);
      result += IdGenerator.DIGITS[randomIndex];
    }

    return result;
  }

  /**
   * Generate a client ID
   * @param length - Length of random part (default: 8)
   * @returns Client ID (e.g., 'CLA1B2C3D4')
   */
  static generateClientId(length: number = IdGenerator.DEFAULT_LENGTH): string {
    return IdGenerator.generate(EntityPrefix.CLIENT, length);
  }

  /**
   * Generate an affiliate ID
   * @param length - Length of random part (default: 8)
   * @returns Affiliate ID (e.g., 'AF1A2B3C4D')
   */
  static generateAffiliateId(
    length: number = IdGenerator.DEFAULT_LENGTH,
  ): string {
    return IdGenerator.generate(EntityPrefix.AFFILIATE, length);
  }

  /**
   * Generate a campaign ID
   * @param length - Length of random part (default: 8)
   * @returns Campaign ID (e.g., 'CM5E6F7G8H')
   */
  static generateCampaignId(
    length: number = IdGenerator.DEFAULT_LENGTH,
  ): string {
    return IdGenerator.generate(EntityPrefix.CAMPAIGN, length);
  }

  static generateCampaignKey(length: number = 12): string {
    return IdGenerator.generateRandomDigits(length);
  }

  /**
   * Generate a lead ID
   * @param length - Length of random part (default: 8)
   * @returns Lead ID (e.g., 'LD9I0J1K2L')
   */
  static generateLeadId(length: number = IdGenerator.DEFAULT_LENGTH): string {
    return IdGenerator.generate(EntityPrefix.LEAD, length);
  }
}
