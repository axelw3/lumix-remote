function escapeRegExp(str){
    return str.replace(/[\-\\\^$*+?\.()|[\]{}]/g, "\\$&");
}

class XML{
	static getTagContents(data, tag){
		return data.slice(data.indexOf("<" + tag + ">") + tag.length + 2, data.indexOf("</" + tag + ">"));
	}

    static getTagAttributeValue(data, tag, attribute){
        let result = new RegExp("<" + escapeRegExp(tag) + "\\s[^>]*" + escapeRegExp(attribute) + "=\"([^\"]*)\"").exec(data);
        if(result && result.length == 2){
            return result[1];
        }
        return "";
    }

	static getAllText(data){
		return data.replace(/\r/g, "").replace(/<[0-9A-Za-z \=\"\'\.\?\-\/^>]*>/g, "");
	}
}

module.exports = XML;