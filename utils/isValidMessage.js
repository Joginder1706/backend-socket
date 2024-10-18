function isValidMessage(message) {
    // Regular expressions to match allowed content
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const phoneRegex = /(\+?\d{1,2}\s?)?(\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}/;
    const socialMediaRegex = /@[a-zA-Z0-9._]+/;

    // Keywords to match disallowed content
    const disallowedKeywords = [
        'sex', 'escort', 'prostitute', 'hookup', 'sugar mommy',
        'pay for sex', 'sex for money', 'gifts for sex', 'exchange sex', 'trade sex'
    ];

    // Check for disallowed keywords
    for (let keyword of disallowedKeywords) {
        if (message.toLowerCase().includes(keyword)) {
            return false; // Message contains disallowed content
        }
    }

    // Regular expression to detect potential physical addresses
    const addressRegex = /\d{1,4}\s\w+\s(Street|St|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Road|Rd|Drive|Dr|Court|Ct|Square|Sq|Place|Pl|Terrace|Ter|Highway|Hwy|Way|Pkwy|Parkway|Circle|Cir|Bypass|Byp|Alley|Aly|Freeway|Fwy|Trail|Trl|Bridge|Brg|Crescent|Cres|Gate|Gte|Mews|Mws|Row|Row|Walk|Wlk|Wharf|Whf|Meadow|Mdow|Boulevard|Blvd)\b/i;

    // Check for potential addresses using the address regex
    if (addressRegex.test(message)) {
        return false; // Message contains a potential address
    }

    // If no disallowed content is found, the message is allowed
    return true;
}

export default isValidMessage;