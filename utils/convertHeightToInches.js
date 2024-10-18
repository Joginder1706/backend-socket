function convertHeightToInches(heightStr) {
    if (typeof heightStr !== 'string') {
        return null;
    }
    const regex = /(\d+)'(\d+)/; // Matches height in feet and inches
    const match = heightStr.match(regex);
    if (match) {
        const feet = parseInt(match[1]);
        const inches = parseInt(match[2]);
        return feet * 12 + inches; // Convert feet to inches and add extra inches
    }
    return null; // If the format is wrong
}

export default convertHeightToInches