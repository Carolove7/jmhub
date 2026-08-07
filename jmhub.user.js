// ==UserScript==
// @name         JMHub 镜像自动跳转
// @namespace    https://github.com/Carolove7/jmhub
// @version      1.2.0
// @description  访问主站地址时立即跳转最新镜像
// @author       Carolove7
// @homepageURL  https://github.com/Carolove7/jmhub
// @supportURL   https://github.com/Carolove7/jmhub/issues
// @icon         https://jmcomicmi.net/favicon.ico
// @updateURL    https://g.blfrp.cn/https://raw.githubusercontent.com/Carolove7/jmhub/main/jmhub.user.js
// @downloadURL  https://g.blfrp.cn/https://raw.githubusercontent.com/Carolove7/jmhub/main/jmhub.user.js
//
// 主站匹配
// @match        https://18comic.vip/*
// @match        https://*.18comic.vip/*
// @match        https://18comic.ink/*
// @match        https://*.18comic.ink/*
//
// 权限
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
//
// 跨域
// @connect      g.blfrp.cn
// @connect      raw.githubusercontent.com
//
// 启动时间
// @run-at       document-start
// ==/UserScript==


(() => {

"use strict";


// ===============================
// 镜像数据地址
// ===============================

const MIRROR_DATA_URL =
"https://g.blfrp.cn/https://raw.githubusercontent.com/Carolove7/jmhub/main/data/mirror.json";


const DIRECT_DATA_URL =
"https://raw.githubusercontent.com/Carolove7/jmhub/main/data/mirror.json";


// ===============================
// 缓存设置
// ===============================

const CACHE_KEY =
"jmhub_mirror_cache";


const CACHE_TTL =
6 * 60 * 60 * 1000;


const REQUEST_TIMEOUT =
8000;



// ===============================
// 读取缓存
// ===============================

function readCache(){

    try{

        const cache =
        GM_getValue(
            CACHE_KEY,
            null
        );


        if(
            !cache ||
            !cache.data
        ){
            return null;
        }


        if(
            Date.now() -
            cache.time >
            CACHE_TTL
        ){
            return null;
        }


        return cache.data;


    }catch(e){

        return null;

    }

}



// ===============================
// 写入缓存
// ===============================

function writeCache(data){

    try{

        GM_setValue(
            CACHE_KEY,
            {
                time:Date.now(),
                data:data
            }
        );


    }catch(e){

    }

}



// ===============================
// HTTP 请求
// ===============================

function request(url){

    return new Promise(
        (resolve,reject)=>{


        GM_xmlhttpRequest({

            method:"GET",

            url:
            url +
            "?t=" +
            Date.now(),


            timeout:
            REQUEST_TIMEOUT,


            headers:{

                "Cache-Control":
                "no-cache"

            },


            onload(response){


                if(
                    response.status < 200 ||
                    response.status >= 300
                ){

                    reject(
                        new Error(
                            "HTTP "+
                            response.status
                        )
                    );

                    return;

                }


                try{

                    resolve(
                        JSON.parse(
                            response.responseText
                        )
                    );


                }catch(e){

                    reject(e);

                }

            },


            onerror(){

                reject(
                    new Error(
                        "request failed"
                    )
                );

            },


            ontimeout(){

                reject(
                    new Error(
                        "request timeout"
                    )
                );

            }


        });


    });

}



// ===============================
// 获取镜像数据
// ===============================

async function fetchData(){


    // 优先加速站

    try{


        const data =
        await request(
            MIRROR_DATA_URL
        );


        writeCache(data);


        return data;


    }catch(e){


        console.warn(
            "[JMHub] 加速站失败:",
            e
        );

    }



    // 回退 GitHub

    try{


        const data =
        await request(
            DIRECT_DATA_URL
        );


        writeCache(data);


        return data;


    }catch(e){


        console.warn(
            "[JMHub] GitHub失败:",
            e
        );


        return null;

    }

}



// ===============================
// URL 清理
// ===============================

function normalizeList(list){


    if(
        !Array.isArray(list)
    ){

        return [];

    }


    return list
    .map(url=>{


        try{


            const u =
            new URL(url);


            if(
                !(
                    u.protocol==="http:" ||
                    u.protocol==="https:"
                )
            ){

                return null;

            }


            return u.origin;


        }catch(e){

            return null;

        }


    })
    .filter(Boolean);


}



// ===============================
// 镜像优先级
// ===============================

function getCandidates(data){


    return [
        ...normalizeList(
            data.china
        ),

        ...normalizeList(
            data.flow1
        ),

        ...normalizeList(
            data.flow2
        )

    ].filter(
        (item,index,array)=>
        array.indexOf(item)===index
    );


}



// ===============================
// 保留路径跳转
// ===============================

function buildTarget(origin){


    const target =
    new URL(origin);


    target.pathname =
    location.pathname;


    target.search =
    location.search;


    target.hash =
    location.hash;


    return target.href;

}



// ===============================
// 主程序
// ===============================

async function main(){


    let data =
    readCache();



    if(!data){


        data =
        await fetchData();


    }



    if(!data){

        console.warn(
            "[JMHub] 无镜像数据"
        );

        return;

    }



    const candidates =
    getCandidates(data);



    if(
        candidates.length===0
    ){

        console.warn(
            "[JMHub] 镜像为空"
        );

        return;

    }



    const currentHost =
    location.hostname;



    /*
       如果已经在镜像站，
       不执行跳转
    */

    const target =
    candidates.find(origin=>{


        try{


            return (
                new URL(origin)
                .hostname
                !==
                currentHost
            );


        }catch(e){

            return false;

        }


    });



    if(!target){

        return;

    }



    const url =
    buildTarget(target);



    console.log(
        "[JMHub] 跳转:",
        url
    );



    location.replace(url);



}



// 执行

main();


})();
