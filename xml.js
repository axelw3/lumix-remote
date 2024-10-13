class XML{
	static getXMLValue(data, tag){
		return data.slice(data.indexOf("<" + tag + ">") + tag.length + 2, data.indexOf("</" + tag + ">"));
	}

	static getXMLText(data){
		return data.replace(/\r/g, "").replace(/<[0-9A-Za-z \=\"\'\.\?\-\/^>]*>/g, "");
	}
}

module.exports = XML;