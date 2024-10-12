const dgram=require("dgram");
const readline = require("readline");
const http=require('http');
const ws=require("ws");
const fs=require("fs");
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function logMsg(type,msg){
	let time=new Date();
	let timestamp=time.getFullYear()+"-"+time.getMonth()+"-"+time.getDate()+" "+time.getHours()+":"+time.getMinutes()+":"+time.getSeconds();
	console.log(timestamp+" ["+type+"] "+msg.replace(/\n/g,""));
}

class LUMIX{
	constructor(ip){
		this.a=ip;
		this.connected=false;
		this.ready=false;
		this.timelapse_interval;
		this.status_interval;
		this.websocket;
		this.SOAP=false;
		this.state={
			timed_shutter:false,
			timed_shutter_t:5,
			timelapse_running:false,
			photo_mode:0,
			shtr:9,
			aperture:1,
			iso:3,
			wb:4000,
			auto_exp:{
				enabled:false,
				order:["shtr","aperture","iso"],
				iso_limit:[1,7],
				shtr_limit:[1,52],
				aperture_limit:[1,10] // TODO: Denna måste begränsas beroende på brännvidd/zoom?
			}
		};
		this.last_pic=[119,562];
		this.last_pic_data={id:"0-0",data:""};
		this.timelapse_data=null;
		this.constants={
			shtr_speeds_str:[0,"1/2000","1/1600","1/1300","1/1000","1/800","1/640","1/500","1/400","1/320","1/250","1/200","1/160","1/125","1/100","1/80","1/60","1/50","1/40","1/30","1/25","1/20","1/15","1/13","1/10","1/8","1/6","1/5","1/4","1/3.2","1/2.5","1/2","1/1.6","1/1.3","1","1.3","1.6","2","2.5","3.2","4","5","6","8","10","13","15","20","25","30","40","50","60","T"],
			shtr_speeds:[0,1/2000,1/1600,1/1300,1/1000,1/800,1/640,1/500,1/400,1/320,1/250,1/200,1/160,1/125,1/100,1/80,1/60,1/50,1/40,1/30,1/25,1/20,1/15,1/13,1/10,1/8,1/6,1/5,1/4,1/3.2,1/2.5,1/2,1/1.6,1/1.3,1,1.3,1.6,2,2.5,3.2,4,5,6,8,10,13,15,20,25,30,40,50,60],
			apertures:[0,2.8,3.2,3.5,4,4.5,5,5.6,6.3,7.1,8],
			isos:[0,80,100,125,200,400,800,1600,3200,6400,12800,25600],
			camera_shtr:[0,2816,2731,2646,2560,2475,2390,2304,2219,2134,2048,1963,1878,1792,1707,1622,1536,1451,1366,1280,1195,1110,1024,939,854,768,683,598,512,427,342,256,171,86,0,65451,65366,65280,65195,65110,65024,64939,64854,64768,64683,64598,64512,64427,64342,64256,64171,64086,64000,16384], // 16384 = T
			camera_aperture:[0,768,854,938,1024,1110,1195,1280,1366,1451,1536]
		};
	}
	connect(){
		return new Promise((resolve,reject)=>{
			if(!this.connected){
				logMsg("CAM_CONNECTING",this.a);
				this.sendCommand("mode=camcmd&value=playmode").then(()=>{
					this.sendCommand("mode=get_content_info").then(res=>{
						let num=parseInt(XML.getXMLValue(res,"content_number"));
						this.init(num||1).then((img_num)=>{
							if(img_num!==false){
								if(img_num.length==2){
									this.last_pic=img_num;
								}
							}
							this.connected=true;
							this.sendCommand("mode=getsetting&type=shtrspeed").then(shtr_speed=>{
								let shutter=parseInt(shtr_speed.split('shtrspeed="')[1].split("/")[0]);
								let shtrs=this.constants.camera_shtr;
								let sp_id=this.constants.camera_shtr.reduce(function(pr,cu,i){
									let prev=shtrs[pr];
									if(Math.abs(prev-shutter) < Math.abs(cu-shutter)){
										return pr;
									} else {
										return i;
									}
								},0);
								if(!isNaN(sp_id) && sp_id>=1 && sp_id<camera.constants.shtr_speeds.length){
									this.state.shtr=sp_id;
									logMsg("CAM_GETSETTING_DONE","Slutartid från kameran: "+camera.constants.shtr_speeds_str[sp_id]+" s");
								} else if(sp_id==53){
									this.setShutter(52);
									logMsg("CAM_GETSETTING_SHTR_T","Slutaren på kameran var inställd på T, ändrar till 60s");
								} else {
									logMsg("CAM_GETSETTING_ERROR","Kunde inte läsa slutartiden från kameran.");
								}
							},err=>logMsg("CAM_GETSETTING_ERROR","Kunde inte hämta slutartiden från kameran."));
							this.sendCommand("mode=getsetting&type=iso").then(iso_val=>{
								let iso_int=parseInt(iso_val.split('iso="')[1].split('"')[0]);
								let iso_id=this.constants.isos.indexOf(iso_int);
								if(!isNaN(iso_id) && iso_id>=1 && iso_id<this.constants.isos.length){
									this.state.iso=iso_id;
									logMsg("CAM_GETSETTING_DONE","ISO från kameran: "+iso_int);
								} else {
									logMsg("CAM_GETSETTING_ERROR","Kunde inte läsa ISO från kameran.");
								}
							},err=>logMsg("CAM_GETSETTING_ERROR","Kunde inte hämta ISO från kameran."));
							// Aperture
							this.sendCommand("mode=getsetting&type=focal").then(aperture=>{
								let aperture2=parseInt(aperture.split('focal="')[1].split("/")[0]);
								let apertures=this.constants.camera_aperture;
								let aperture_id=this.constants.camera_aperture.reduce((pr,cu,i)=>{
									let prev=apertures[pr];
									if(Math.abs(prev-aperture2) < Math.abs(cu-aperture2)){
										return pr;
									} else {
										return i;
									}
								},0);
								if(!isNaN(aperture_id) && aperture_id>=1 && aperture_id<this.constants.apertures.length){
									this.state.aperture=aperture_id;
									logMsg("CAM_GETSETTING_DONE","Bländartal från kameran: f/"+this.constants.apertures[aperture_id]);
								} else {
									logMsg("CAM_GETSETTING_ERROR","Kunde inte läsa bländartal från kameran.");
								}
							},err=>logMsg("CAM_GETSETTING_ERROR","Kunde inte hämta bländartal från kameran."));
							
							resolve(XML.getXMLValue(res,"result")||"");
						});
					},reject);
				},reject);
			} else {
				logMsg("CAM_ALREADY_CONNECTED","Kameran är redan ansluten.");
				resolve("Redan ansluten.");
			}
		});
	}
	init(num){
		// Starta SOAP
		return new Promise((resolve,reject)=>{
			let request = http.request({host:this.a,port:60606,path:'/Server0/CDS_control',method:'POST',headers:{'Content-Type':'text/xml; charset="UTF-8"','SOAPAction':'"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"'}},function(res) {
    			res.setEncoding('utf8');
    			let data="";
    			res.on('data',function(chunk){
    				data+=chunk.replace(/\&quot\;/g,"\"").replace(/\&gt\;/g,">").replace(/\&lt\;/g,"<")
    			});
    			res.on('end',function(){
    				let img_num=data.slice(data.indexOf('dc:title>')+9).slice(0,8).split("-");
    				this.SOAP=true;
    				logMsg("CAM_SOAP_DONE","Hämtade senaste bild-id: "+img_num.join(""));
    				resolve([parseInt(img_num[0]),parseInt(img_num[1])]);
    			});
			});
			request.on("error",function(err){
				logMsg("CAM_SOAP_FAIL","Misslyckades att skicka SOAP-brevet. Fel: "+err);
				this.SOAP=false;
				resolve(false);
			});
			request.write('<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"><ObjectID>0</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag><Filter></Filter><StartingIndex>'+(num-1)+'</StartingIndex><RequestedCount>1</RequestedCount><SortCriteria></SortCriteria></u:Browse></s:Body></s:Envelope>');
			request.end();
		});
	}
	
	
	
	// Viktiga funktioner med kameran
	setMode(newmode){
		if(newmode=="rec"){
			return this.sendCommand("mode=camcmd&value=recmode");
		} else if(newmode=="play"){
			return this.sendCommand("mode=camcmd&value=playmode");
		} else {
			return new Promise((resolve,reject)=>{
				reject("Okänt läge (\""+newmode+"\")")
			});
		}
	}
	capture(){
		return new Promise((resolve,reject)=>{
			if(!this.state.timed_shutter){
				if(this.state.auto_exp.enabled==true){
					this.autoAdjustExp().then(()=>{
						this.sendCommand("mode=camcmd&value=capture").then(()=>{
							setTimeout(()=>{
								this.pictureTaken();
							},this.constants.shtr_speeds[this.state.shtr]*1000);
						},reject);
						this.websocket.send("syncstate_"+JSON.stringify(camera.state));
					},err=>{
						logMsg("AUTO_EXP_ERROR","Kunde inte justera exponeringen. Fel: "+err);
						this.sendCommand("mode=camcmd&value=capture").then(()=>{
							setTimeout(()=>{
								this.pictureTaken();
							},this.constants.shtr_speeds[this.state.shtr]*1000);
						},reject);
					});
				} else {
					this.sendCommand("mode=camcmd&value=capture").then(()=>{
						setTimeout(()=>{
							this.pictureTaken();
						},this.constants.shtr_speeds[this.state.shtr]*1000);
					},reject);
				}
			} else {
				this.sendCommand("mode=camcmd&value=capture").then(()=>{
					setTimeout(()=>{
						this.sendCommand("mode=camcmd&value=capture_cancel").then(resolve,reject);
						this.pictureTaken();
					},this.state.timed_shutter_t*1000);
				},reject);
			}
		});
	}
	cancelCapture(){
		return this.sendCommand("mode=camctrl&type=capture_cancel");
	}
	setShutter(speed_id){
		return new Promise((resolve,reject)=>{
			if(speed_id!==this.state.shtr){
				let cmd;
				if(speed_id<=52){
					this.state.shtr=speed_id;
					let val=Math.round(2816-85.30232558139535*(speed_id-1));
					cmd="mode=setsetting&type=shtrspeed&value="+val+"/256";
				} else {
					cmd="mode=setsetting&type=shtrspeed&value=16384/256";
				}
				this.sendCommand(cmd).then((res)=>{
					logMsg("SET_SHUTTER_DONE","Ställde in slutartiden till: "+this.constants.shtr_speeds_str[speed_id]+" s");resolve(res);
				},(err)=>{
					logMsg("SET_SHUTTER_ERROR","Kunde inte ställa in slutartiden: "+err);reject(err);
				});
			}else{
				logMsg("SET_SHUTTER_NC","Slutartiden är redan "+this.constants.shtr_speeds_str[speed_id]+" s.");
				resolve("Slutartiden ändrades inte.");
			}
		});
	}
	setISO(iso){
		return new Promise((resolve,reject)=>{
			let new_iso_id=this.constants.isos.indexOf(parseInt(iso));
			if(this.state.iso!==new_iso_id){
				this.state.iso=this.constants.isos.indexOf(parseInt(iso));
				this.sendCommand("mode=setsetting&type=iso&value="+iso).then((res)=>{
					logMsg("SET_ISO_DONE","Ställde in ISO till: "+iso);
					resolve(res);
				},(err)=>{
					logMsg("SET_ISO_ERROR","Kunde inte ställa in ISO: "+err);
					reject(err);
				});
			} else {
				logMsg("SET_ISO_NC","ISO-känsligheten är redan "+iso+".");
				resolve("ISO ändrades inte.");
			}
		});
	}
	setWB(wb){
		this.state.wb=parseInt(wb);
		return this.sendCommand("mode=setsetting&type=whitebalance&value=color_temp&value2="+wb);
	}
	setAperture(aperture_id){
		return new Promise((resolve,reject)=>{
			if(this.state.aperture!==aperture_id){
				this.state.aperture=aperture_id;
				this.sendCommand("mode=setsetting&type=focal&value="+Math.round(768+85.30232558139535*(parseInt(aperture_id)-1))+"/256").then((res)=>{
					logMsg("SET_APERTURE_DONE","Ställde in aperture till: f/"+this.constants.apertures[aperture_id]);resolve(res);
				},(err)=>{
					logMsg("SET_APERTURE_ERROR","Kunde inte ställa in aperture: "+err);reject(err);
				});
			}else{
				logMsg("SET_APERTURE_NC","Aperture är redan f/"+this.constants.apertures[aperture_id]+".");
				resolve("Aperture ändrades inte.");
			}
		});
	}
	setFocus(percent,iter){
		return new Promise((resolve,reject)=>{
			this.sendCommand("mode=camctrl&type=focus&value=tele-normal").then(res=>{
				let res_parsed=res.split(",");
				if(res_parsed[0]=="ok"){
					let goal_focus=parseInt(res_parsed[2])*(percent/100);
					let curr_focus=parseInt(res_parsed[1]);
					let tryFocus=(curr,goal,i)=>{
						let speed=(Math.abs(curr-goal)>35)?"fast":"normal";
						if(curr>goal){
							this.sendCommand("mode=camctrl&type=focus&value=tele-"+speed).then((res)=>{
								let parsed=res.split(",");
								if(parsed[0]=="ok"){
									let res_focus=parseInt(parsed[1]);
									logMsg("FOCUS_SET","Fokus ändras till "+goal+" ("+percent+"%)... (nu: "+res_focus+")");
									if(i>1 && Math.abs(res_focus-goal) > 10){
										setTimeout(()=>tryFocus(res_focus,goal,i-1),150);
									} else {
										logMsg("FOCUS_DONE","Fokus ställdes till "+percent+"%.");
										resolve();
									}
								} else {
									logMsg("FOCUS_ERROR","Fokus kunde inte ändras: "+res);
									reject();
								}
							},reject);
						} else {
							this.sendCommand("mode=camctrl&type=focus&value=wide-"+speed).then((res)=>{
								let parsed=res.split(",");
								if(parsed[0]=="ok"){
									let res_focus=parseInt(parsed[1]);
									logMsg("FOCUS_SET","Fokus ändras till "+goal+" ("+percent+"%)... (nu: "+res_focus+")");
									if(i>1 && Math.abs(res_focus-goal) > 5){
										setTimeout(()=>tryFocus(res_focus,goal,i-1),150);
									} else {
										logMsg("FOCUS_DONE","Fokus ställdes till "+goal+" ("+percent+"%).");
										resolve();
									}
								} else {
									reject();
								}
							},reject);
						}
						
					};
					tryFocus(curr_focus,goal_focus,iter);
				} else {
					reject();
				}
			},reject);
		});
	}
	focusNear(){
		return this.sendCommand("mode=camctrl&type=focus&value=wide-normal");
	}
	focusFar(){
		return this.sendCommand("mode=camctrl&type=focus&value=tele-normal");
	}
	selectMode(mode){
		if(mode==1){
			// Timelapse mode
			logMsg("CAM_SET_MODE","Använder timelapse-läge.");
			this.state.photo_mode=1;
			this.setDriveMode(0);
		} else if(mode==0){
			// Photo
			logMsg("CAM_SET_MODE","Använder foto-läge.");
			this.state.photo_mode=0;
			this.setDriveMode(0);
		} else if(mode==2){
			// Burst
			logMsg("CAM_SET_MODE","Använder bildserie-läge.");
			this.state.photo_mode=2;
			this.setDriveMode(1);
		}
	}
	setDriveMode(mode){
		if(mode==0){
			//logMsg("CAM_SET_DRIVEMODE","Använder normalt läge.");
			return this.sendCommand("mode=setsetting&type=drivemode&value=normal");
		} else if(mode==1){
			//logMsg("CAM_SET_DRIVEMODE","Använder burst-läge.");
			return this.sendCommand("mode=setsetting&type=drivemode&value=burst");
		} else {
			return new Promise((res,rej)=>rej());
		}
	}
	
	pictureTaken(){
		// Varje gång ett foto tas med kameran så kommer denna funktion att köras 1 gång.
		//logMsg("PICTURE_TAKEN","Ett foto har tagits! #OLOF");
		if(this.last_pic[1]>=999){
			this.last_pic=[this.last_pic[0]+1,1];
		} else {
			this.last_pic[1]=this.last_pic[1]+1;
		}
	}
	
	// Timer-relaterade funktioner
	
	startTimelapse(interval,pictures){
		if(!isNaN(interval) && !isNaN(pictures)){
			// interval in seconds
			this.timelapse_data={
				total_pics:parseInt(pictures),
				interval:parseInt(interval),
				remaining:parseInt(pictures)
			};
			this.state.timelapse_running=true;
			logMsg("TIMELAPSE","Startar timelapse ("+pictures+" x "+interval+"s)...");
			this.websocket.send("tlsync_"+interval+"&"+pictures+"&begin");
			this.timelapse_interval=setInterval(()=>{
				this.timelapse_data.remaining--;
				this.capture();
				this.websocket.send("tlsync_"+interval+"&"+pictures+"&"+this.timelapse_data.remaining);
				
				let remaining=Math.ceil(interval*this.timelapse_data.remaining/60);
				logMsg("TIMELAPSE","Tar foto "+(this.timelapse_data.total_pics-this.timelapse_data.remaining).toString(10)+"/"+pictures+"... ("+remaining+" minut"+((remaining==1)?"":"er")+" återstår)");
				
				if(this.timelapse_data.remaining==0){
					// Timelapse färdig
					logMsg("TIMELAPSE","Timelapse färdig.");
					this.websocket.send("tldone");
					this.timelapse_data=null;
					this.state.timelapse_running=false;
					clearInterval(this.timelapse_interval);
				}
			},interval*1000);
		}else{
			logMsg("TIMELAPSE_ERROR","Någon av de angivna siffrorna är NaN");
		}
	}
	
	autoAdjustExp(){
		return new Promise((resolve,reject)=>{
			if(!this.state.timed_shutter){
				let opt=this.state.auto_exp;
				let new_exp={
					iso:this.state.iso,
					shtr:this.state.shtr,
					aperture:this.state.aperture
				};
				this.getLiveExp().then(res=>{
					let iso_ne;
					logMsg("AUTO_EXP","Nuvarande exponering: "+Math.floor(res/0.3)/10+" EV");
					for(let z=Math.abs(res);z>0;z--){
						if(res<0){
							if(new_exp.iso<3){
								iso_ne=1; // ISO 80-100 (1/3 stop vid höjning)
							} else if(new_exp.iso<4){
								iso_ne=2; // ISO 125 (2/3 stop vid höjning)
							} else {
								iso_ne=3; // ISO >125 (1 stop vid höjning)
							}
							// För mörkt.
							if(opt.order[0]=="shtr"&&new_exp.shtr<opt.shtr_limit[1]){
								new_exp.shtr++;
								//logMsg("AUTO_EXP","(0) Höjer slutartiden till "+new_exp.shtr);
							} else if(opt.order[0]=="aperture"&&new_exp.aperture>opt.aperture_limit[0]){
								new_exp.aperture--;
								//logMsg("AUTO_EXP","(0) Sänker bländartalet till "+new_exp.aperture);
							} else if(opt.order[0]=="iso"&&new_exp.iso<opt.iso_limit[1]&&z>=iso_ne){
								z-=(iso_ne-1);
								new_exp.iso++;
								//logMsg("AUTO_EXP","(0) Höjer ISO till "+new_exp.iso);
							} else if(opt.order[1]=="shtr"&&new_exp.shtr<opt.shtr_limit[1]){
								new_exp.shtr++;
								//logMsg("AUTO_EXP","(1) Höjer slutartiden till "+new_exp.shtr);
							} else if(opt.order[1]=="aperture"&&new_exp.aperture>opt.aperture_limit[0]){
								new_exp.aperture--;
								//logMsg("AUTO_EXP","(1) Sänker bländartalet till "+new_exp.aperture);
							} else if(opt.order[1]=="iso"&&new_exp.iso<opt.iso_limit[1]&&z>=iso_ne){
								z-=(iso_ne-1);
								new_exp.iso++;
								//logMsg("AUTO_EXP","(1) Höjer ISO till "+new_exp.iso);
							} else if(opt.order[2]=="shtr"&&new_exp.shtr<opt.shtr_limit[1]){
								new_exp.shtr++;
								//logMsg("AUTO_EXP","(2) Höjer slutartiden till "+new_exp.shtr);
							} else if(opt.order[2]=="aperture"&&new_exp.aperture>opt.aperture_limit[0]){
								new_exp.aperture--;
								//logMsg("AUTO_EXP","(2) Sänker bländartalet till "+new_exp.aperture);
							} else if(opt.order[2]=="iso"&&new_exp.iso<opt.iso_limit[1]&&z>=iso_ne){
								z-=(iso_ne-1);
								new_exp.iso++;
								//logMsg("AUTO_EXP","(2) Höjer ISO till "+new_exp.shtr);
							} else {
								z=0;
								logMsg("AUTO_EXP_WARN","Kan inte höja exponering, max nådd.");
							}
						} else if(res>0){
							// För ljust.
							if(new_exp.iso<4){
								iso_ne=1; // ISO 80-125 (1/3 stop vid sänkning)
							} else if(new_exp.iso<5){
								iso_ne=2; // ISO 200 (2/3 stop vid sänkning)
							} else {
								iso_ne=3; // ISO >200 (1 stop vid höjning)
							}
							if(opt.order[2]=="shtr"&&new_exp.shtr>opt.shtr_limit[0]){
								new_exp.shtr--;
								//logMsg("AUTO_EXP","(2) Sänker slutartiden till "+new_exp.shtr);
							} else if(opt.order[2]=="aperture"&&new_exp.aperture<opt.aperture_limit[1]){
								new_exp.aperture++;
								//logMsg("AUTO_EXP","(2) Höjer bländartalet till "+new_exp.aperture);
							} else if(opt.order[2]=="iso"&&new_exp.iso>opt.iso_limit[0]&&z>=iso_ne){
								z-=(iso_ne-1);
								new_exp.iso--;
								//logMsg("AUTO_EXP","(2) Sänker ISO till "+new_exp.iso);
							} else if(opt.order[1]=="shtr"&&new_exp.shtr>opt.shtr_limit[0]){
								new_exp.shtr--;
								//logMsg("AUTO_EXP","(1) Sänker slutartiden till "+new_exp.shtr);
							} else if(opt.order[1]=="aperture"&&new_exp.aperture<opt.aperture_limit[1]){
								new_exp.aperture++;
								//logMsg("AUTO_EXP","(1) Höjer bländartalet till "+new_exp.aperture);
							} else if(opt.order[1]=="iso"&&new_exp.iso>opt.iso_limit[0]&&z>=iso_ne){
								z-=(iso_ne-1);
								new_exp.iso--;
								//logMsg("AUTO_EXP","(1) Sänker ISO till "+new_exp.iso);
							} else if(opt.order[0]=="shtr"&&new_exp.shtr>opt.shtr_limit[0]){
								new_exp.shtr--;
								//logMsg("AUTO_EXP","(0) Sänker slutartiden till "+new_exp.shtr);
							} else if(opt.order[0]=="aperture"&&new_exp.aperture<opt.aperture_limit[1]){
								new_exp.aperture++;
								//logMsg("AUTO_EXP","(0) Höjer bländartalet till "+new_exp.aperture);
							} else if(opt.order[0]=="iso"&&new_exp.iso>opt.iso_limit[0]&&z>=iso_ne){
								z-=(iso_ne-1);
								new_exp.iso--;
								//logMsg("AUTO_EXP","(2) Sänker ISO till "+new_exp.iso);
							} else {
								z=0;
								logMsg("AUTO_EXP_WARN","Kan inte sänka exponering, minimum nått.");
							}
						}
						if(z<=1){
							logMsg("AUTO_EXP","Ställer in inställningar på kameran: "+JSON.stringify(new_exp));
							this.setShutter(new_exp.shtr).then(()=>{
								this.setISO(this.constants.isos[new_exp.iso]).then(()=>{
									this.setAperture(new_exp.aperture).then(()=>{
										logMsg("AUTO_EXP_DONE","Färdig!");
										resolve(new_exp);
									},reject);
								},reject);
							},reject);
						}
					}
					if(res==0){
						resolve(new_exp);
					}
				},reject);
			} else {
				reject("Timed shutter stöds ej med auto-exp.");
			}
		});
	}
	
	getLiveExp(){
		return new Promise((resolve,reject)=>{
			this.sendCommand("mode=startstream&value=49199").then(()=>{
				let socket=dgram.createSocket('udp4');
				let open=false;
				socket.on('error',function(error){
  					logMsg("UDP_ERROR","Socket-fel: "+error);
  					if(open){
  						socket.close();
  					}
  					this.sendCommand("mode=stopstream").then(()=>{
  						reject("Socket-fel.");
  					},(err)=>{
  						logMsg("GET_EXP_WARN","Kunde inte stoppa stream: "+err);
						reject("Socket-fel.");
  					});
				});
				socket.on('message',(data,info)=>{
					//logMsg("UDP_DATA","Tog emot "+data.length+" bytes från "+info.address+":"+info.port+".");
					socket.close(()=>{
						if(data[140]>=0x06 && data[140]<=0x18){
							let ev_id=parseInt(data[140],10)-6;
							let evs=[-3,-2.6,-2.3,-2,-1.6,-1.3,-1,-0.6,-0.3,0,0.3,0.6,1,1.3,1.6,2,2.3,2.6,3];
							let evs_num=[-9,-8,-7,-6,-5,-4,-3,-2,-1,0,1,2,3,4,5,6,7,8,9];
							
							this.sendCommand("mode=stopstream").then(()=>{
								resolve(evs_num[ev_id]);
							},(err)=>{
								logMsg("GET_EXP_WARN","Kunde inte stoppa stream: "+err);
								resolve(evs_num[ev_id]);
							});
						}else{
							this.sendCommand("mode=stopstream").then(()=>{
								reject("Ogiltigt svar.");
							},(err)=>{
								logMsg("GET_EXP_WARN","Kunde inte stoppa stream: "+err);
								reject("Ogiltigt svar.");
							});
						}
					});
				});
				socket.on('listening',function(){
					open=true;
  					logMsg("UDP_LISTEN","Lyssnar på port "+socket.address().port);
				});
				socket.on('close',function(){
					open=false;
  					//logMsg("UDP_CLOSE","Socket stängd.");
				});
				socket.bind(49199);
				let timeout=setTimeout(()=>{
					if(open){
						socket.close();
						this.sendCommand("mode=stopstream").then(()=>{
							reject("Timeout");
						},(err)=>{
							logMsg("GET_EXP_WARN","Kunde inte stoppa stream: "+err);
							reject("Timeout");
						});
					}
				},4000);
			});
		});
	}
	
	getLastPic(callback){
		let spl_id=this.last_pic_data.id.split("-");
		if(parseInt(spl_id[0])==this.last_pic[0] && parseInt(spl_id[1])==this.last_pic[1] && this.last_pic_data.data.length>99){
			logMsg("CAM_GET_IMG","Den senaste bilden är redan hämtad. Skickar ingen ny begäran.");
			callback(this.last_pic_data.data);
		} else {
			let options={
  				hostname:camera.a,
  				port:50001,
  				path:"/DS"+camera.last_pic[0].toString(10)+("000"+camera.last_pic[1]).slice(-4)+".JPG",
  				method:"GET",
  				headers:{"User-Agent": "Lumix HTTP Remote"}
			};
			logMsg("CAM_GET_IMG","Hämtar senaste bilden ("+options.path)+")...";
			let request=http.request(options, (re) => {
				let data=[];
				re.setEncoding("binary");
				re.on("data",function(chunk){
					data.push(Buffer.from(chunk,"binary"));
				});
  				re.on("end",()=>{
  					let result=Buffer.concat(data);
  					if(result.length>99){
  						this.last_pic_data={id:this.last_pic.join("-"),data:result};
    					callback(Buffer.concat(data));
    				} else {
    					logMsg("LATEST_IMG_ERROR","Kunde inte hämta den senaste bilden (ingen svarsdata).");
    					callback(false);
    				}
				});
			});
			
			request.on("error", (e) => {
				logMsg("LATEST_IMG_ERROR","Kunde inte hämta den senaste bilden. Fel: "+e.message);
				callback(false);
			});
			request.end();
		} //else {
		//	logMsg("LATEST_IMG_ERROR","SOAP har inte startats.");
		//}
	}
	
	getCameraState(){
		return new Promise((resolve,reject)=>{
			this.sendCommand("mode=getstate").then((result)=>{
				let status={
					batt:XML.getXMLValue(result,"batt"),
					cammode:XML.getXMLValue(result,"cammode"),
					remaincapacity:parseInt(XML.getXMLValue(result,"remaincapacity")),
					sdcardstatus:XML.getXMLValue(result,"sdcardstatus"),
					sd_memory:XML.getXMLValue(result,"sd_memory"),
					video_remaincapacity:parseInt(XML.getXMLValue(result,"video_remaincapacity")),
					rec:XML.getXMLValue(result,"rec"),
					burst_interval_status:XML.getXMLValue(result,"burst_interval_status"),
					sd_access:XML.getXMLValue(result,"sd_access"),
					rem_disp_typ:XML.getXMLValue(result,"rem_disp_typ"),
					progress_time:XML.getXMLValue(result,"progress_time"),
					operate:XML.getXMLValue(result,"operate"),
					stop_motion_num:parseInt(XML.getXMLValue(result,"stop_motion_num")),
					stop_motion:XML.getXMLValue(result,"stop_motion"),
					temperature:XML.getXMLValue(result,"temperature"),
					lens:XML.getXMLValue(result,"lens"),
					add_location_data:XML.getXMLValue(result,"add_location_data"),
					interval_status:XML.getXMLValue(result,"interval_status"),
					sdi_state:XML.getXMLValue(result,"sdi_state"),
					sd2_cardstatus:XML.getXMLValue(result,"sd2_cardstatus"),
					sd2_memory:XML.getXMLValue(result,"sd2_memory"),
					sd2_access:XML.getXMLValue(result,"sd2_access"),
					current_sd:XML.getXMLValue(result,"current_sd"),
					backupmode:XML.getXMLValue(result,"backupmode"),
					batt_grip:XML.getXMLValue(result,"batt_grip"),
					warn_disp:XML.getXMLValue(result,"warn_disp"),
					version:XML.getXMLValue(result,"version")
				};
				logMsg("CAM_STATUS","Batteri: "+status.batt+", temp: "+status.temperature+", ledigt utrymme: "+status.remaincapacity+" bilder.");
				resolve(status);
			},(err)=>reject(err));
		});
	}
	sendCommand(cmd){
		let a_ip=this.a;
		logMsg("CAM_CMD",cmd);
		/*return new Promise(function(res,rej){
			res("Lyckades!");
		});*/
		return new Promise(function(res,rej){
			const options = {
  				hostname:a_ip,
  				port:80,
  				path:"/cam.cgi?"+cmd,
  				method:"GET",
  				headers:{"User-Agent": "Lumix HTTP Remote"}
			};
			
			const req = http.request(options, (re) => {
				let data="";
  				re.setEncoding("utf8");
  				
  				re.on("data",function(chunk){
    				data+=chunk;
  				});
  				
  				re.on("end",function(){
    				res(data);
  				});
			});
			
			req.on("error", (e) => {
				logMsg("CAM_CMD_ERROR","Error: "+e.message);
  				rej("Error: "+e.message);
			});
			req.end();
		});
	}
}

class XML{
	static getXMLValue(data,tag){
		return data.slice(data.indexOf("<"+tag+">")+tag.length+2,data.indexOf("</"+tag+">"));
	}
	static getXMLText(data){
		return data.replace(/\r/g,"").replace(/<[0-9A-Za-z \=\"\'\.\?\-\/^>]*>/g, '');
	}
}

var camera;
function begin(ip) {
    camera=new LUMIX(ip);
	camera.connect().then(function(res){
		logMsg("CAM_CONNECTED",XML.getXMLText(res));
		new ws.Server({port:8081},function(){
			logMsg("WS_READY","Lyssnar efter anslutningar på port 8081...");
		}).on('connection', function connection(wss) {
			let remote_addr=wss._socket.remoteAddress.replace(/[^0-9.]/g, '');
			logMsg("WS_CONN","Inkommande anslutning från "+remote_addr);
			camera.websocket=wss;
			wss.on('message', function(message) {
				let msg_parsed=message.split("_");
				logMsg("WS_RX",remote_addr+": "+message);
				if(msg_parsed[0]=="shutter"){
					// Ändra slutartid
					let shtr_speed_id=parseInt(msg_parsed[1]);
					camera.setShutter(shtr_speed_id).then(()=>{},(err)=>{
						wss.send("error_Kunde inte ställa in slutartiden");
					});
				} else if(msg_parsed[0]=="iso"){
					// Ändra ISO-känslighet
					camera.setISO(parseInt(msg_parsed[1])).then(()=>{},(err)=>{
						logMsg("SET_ISO_ERROR","Kunde inte ställa in ISO: "+err);
						wss.send("error_Kunde inte ställa in ISO");
					});
				} else if(msg_parsed[0]=="aperture"){
					// Ändra aperture
					camera.setAperture(parseInt(msg_parsed[1])).then(()=>{},(err)=>{
						wss.send("error_Kunde inte ställa in aperture");
					});
				} else if(msg_parsed[0]=="wb"){
					camera.setWB(parseInt(msg_parsed[1])).then(()=>{},(err)=>{
						wss.send("error_Kunde inte ställa in vitbalans");
					});
				} else if(msg_parsed[0]=="capture"){
					camera.capture();
				} else if(msg_parsed[0]=="cancelcapture"){
					camera.cancelCapture();
				} else if(msg_parsed[0]=="selectmode"){
					camera.selectMode(parseInt(msg_parsed[1]));
				} else if(msg_parsed[0]=="getstate"){
					logMsg("WS_TX",remote_addr+": syncstate_"+JSON.stringify(camera.state));
					wss.send("syncstate_"+JSON.stringify(camera.state));
				} else if(msg_parsed[0]=="tlstart"){
					let split=msg_parsed[1].split("&");
					let interval=parseInt(split[0]);
					let pic_count=parseInt(split[1]);
					camera.startTimelapse(interval,pic_count);
				} else if(msg_parsed[0]=="tlstop"){
					camera.timelapse_data=null;
					camera.state.timelapse_running=false;
					clearInterval(camera.timelapse_interval);
					logMsg("TIMELAPSE_STOP","Timelapse stoppas...");
				} else if(msg_parsed[0]=="getcamstate"){
					camera.getCameraState().then(result=>{
						wss.send("camstate_"+JSON.stringify(result));
					});
				} else if(msg_parsed[0]=="setfocus"){
					camera.setFocus(parseInt(msg_parsed[1]),20);
				} else if(msg_parsed[0]=="tsh"){
					// Timed shutter-läge
					if(msg_parsed[1]=="on"){
						// Aktivera "timed shutter"
						logMsg("TIMED_SHUTTER","Aktiverar \"timed shutter\"...");
						camera.state.timed_shutter=true;
						camera.setShutter(53);
					} else {
						// Avaktivera "timed shutter"
						logMsg("TIMED_SHUTTER","Avaktiverar \"timed shutter\"...");
						camera.state.timed_shutter=false;
						camera.setShutter(camera.state.shtr);
					}
				} else if(msg_parsed[0]=="tshset"){
					let tsh_nt=parseInt(msg_parsed[1]);
					if(!isNaN(tsh_nt)){
						logMsg("TIMED_SHUTTER","Ställer in \"timed shutter\" till "+tsh_nt+"s...");
						camera.state.timed_shutter_t=tsh_nt;
					}
				} else if(msg_parsed[0]=="glpic"){
					// Hämta senaste bild
					camera.getLastPic(res=>{
						if(res!==false){
							wss.send("newimg_image/jpg;base64,"+res.toString("base64"));
						}
					});
				} else if(msg_parsed[0]=="glelv"){
					camera.getLiveExp().then((res)=>{
						logMsg("EXPOSURE_LVL",res[2]+" (brightness: "+res[0]+")");
					});
				} else if(msg_parsed[0]=="lpicid"){
					let newid=msg_parsed[1].split("-");
					camera.last_pic=[parseInt(newid[0]),parseInt(newid[1])];
				} else if(msg_parsed[0]=="connected"){
					if(!camera.ready){
						camera.sendCommand("mode=camcmd&value=recmode").then((res)=>{
							camera.ready=true;
							logMsg("CAM_READY",XML.getXMLText(res));
						},(err)=>{
							camera.ready=false;
							logMsg("CAM_START_ERROR","Kunde inte aktivera recmode på kameran. Fel: "+err);
						});
					}
				} else if(msg_parsed[0]=="aexp"){
					if(msg_parsed[1]=="on"){
						// Avaktivera auto-exponering på servern.
						camera.state.auto_exp.enabled=true;
						logMsg("AUTO_EXP","Auto-exponering har satts på.");
					} else {
						// Aktivera auto-exponering på servern.
						camera.state.auto_exp.enabled=false;
						logMsg("AUTO_EXP","Auto-exponering har stängts av.");
					}
				} else if(msg_parsed[0]=="saexp"){
					// Ställ in auto-exponering på servern.
					let aexp_set=msg_parsed[1].split("&");
					if(aexp_set[0]=="apn"){
						// Aperture min
						camera.state.auto_exp.aperture_limit[0]=parseInt(aexp_set[1]);
						logMsg("AUTO_EXP_CHANGE","Min. aperture: "+aexp_set[1]);
					} else if(aexp_set[0]=="apx"){
						// Aperture max
						camera.state.auto_exp.aperture_limit[1]=parseInt(aexp_set[1]);
						logMsg("AUTO_EXP_CHANGE","Max. aperture: "+aexp_set[1]);
					} else if(aexp_set[0]=="shn"){
						// Shutter min
						camera.state.auto_exp.shtr_limit[0]=parseInt(aexp_set[1]);
						logMsg("AUTO_EXP_CHANGE","Min. slutartid: "+aexp_set[1]);
					} else if(aexp_set[0]=="shx"){
						// Shutter max
						camera.state.auto_exp.shtr_limit[1]=parseInt(aexp_set[1]);
						logMsg("AUTO_EXP_CHANGE","Max. slutartid: "+aexp_set[1]);
					} else if(aexp_set[0]=="ison"){
						// ISO min
						camera.state.auto_exp.iso_limit[0]=parseInt(aexp_set[1]);
						logMsg("AUTO_EXP_CHANGE","Min. ISO: "+aexp_set[1]);
					} else if(aexp_set[0]=="isox"){
						// ISO max
						camera.state.auto_exp.iso_limit[1]=parseInt(aexp_set[1]);
						logMsg("AUTO_EXP_CHANGE","Max. ISO: "+aexp_set[1]);
					} else if(aexp_set[0]=="ord"){
						console.log("Ny ordning: "+aexp_set[1].split("0"));
					}
				}
				
				/*else if(msg_parsed[0]=="foc-n"){ // OBS! Denna är inte fixad på klienten ännu.
					// Fokusera närmre
					camera.focusNear().then(res=>{
						logMsg("SET_FOCUS_DONE","Fokuserade närmre. "+XML.getXMLText(res));
						wss.send("m_focus_"+res);
					},err=>{
						logMsg("SET_FOCUS_ERROR","Kunde inte fokusera: "+err);
						wss.send("e_Kunde inte fokusera.");
					});
				}*/
			});
		});
		http.createServer(function(req, res){
			let html_content=fs.readFileSync("./remote4.html","utf8");
			logMsg("HTTP_GET",req.socket.remoteAddress.replace(/[^0-9.]/g, ''));
			res.writeHead(200,{'Content-Type':'text/html'});
			res.write(html_content.replace("ipa.ddr.ish.ere",req.headers.host.split(":")[0]));
			res.end();
		}).listen(8080,undefined,function(){
			logMsg("HTTP_READY","Lyssnar på port 8080...");
		});
	},function(err){
		logMsg("CAM_CONN_FAIL","Kunde inte ansluta till kameran: "+err);
	});
}


// Start
// Om IP-adressen finns angiven i kommandot, skippa prompt. Annars, fråga efter IP.
if(process.argv.length>=3 && process.argv[2].length>=7){
	begin(process.argv[2]);
} else {
	rl.question("Ange kamerans IP-adress: ",begin);
}
