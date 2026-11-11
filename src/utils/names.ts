// Channel and category names styled with Unicode "fonts" (𝑫𝒂𝒚𝒁, 𝐋𝐅𝐆, ᴅᴀʏᴢ, Ｓｃｒｉｐｔ) are different characters
// from plain letters, so a name check like /lfg/i would miss them. plainName reads them as the letters they
// look like.

/** Small capitals, which Unicode does not fold to plain letters by itself. */
const SMALL_CAPS: Record<string, string> = {
  'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ꜰ': 'f', 'ɢ': 'g', 'ʜ': 'h',
  'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p',
  'ǫ': 'q', 'ʀ': 'r', 'ꜱ': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'ʏ': 'y',
  'ᴢ': 'z',
};

/**
 * A name as plain text: bold, italic, script, double-struck, fullwidth, circled and small-capital letters
 * read as ordinary letters, and the trademark, registered and copyright signs dropped ("Battlefield™ 6" is
 * "Battlefield 6").
 */
export function plainName(name: string): string {
  return [...name.replace(/[™®©]/g, '').normalize('NFKC')].map((char) => SMALL_CAPS[char] ?? char).join('');
}
