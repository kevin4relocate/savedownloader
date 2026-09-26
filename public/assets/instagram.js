const form=document.querySelector('[data-instagram-downloader-form]');
if(form){
  const input=form.querySelector('input[name="url"]');
  const button=form.querySelector('button[type="submit"]');
  const status=document.querySelector('[data-status]');
  const result=document.querySelector('[data-result]');
  const cover=result.querySelector('[data-cover]');
  const title=result.querySelector('[data-title]');
  const author=result.querySelector('[data-author]');
  const chips=result.querySelector('[data-media-chips]');
  const summary=result.querySelector('[data-media-summary]');
  const gallery=result.querySelector('[data-media-gallery]');
  const downloadAllButton=result.querySelector('[data-download-all]');
  const openOriginal=result.querySelector('[data-open-original]');
  const progress=result.querySelector('[data-download-progress]');
  const INSTAGRAM_DOWNLOAD_API='/api/download/instagram';
  const ZIP32_MAX=0xffffffff;
  let currentData=null;
  let crcTable=null;

  const setStatus=(message,type)=>{
    status.textContent=message;
    status.className=`status show ${type||''}`;
  };
  const clearStatus=()=>{status.textContent='';status.className='status';};
  const setProgress=(message,show=true)=>{
    progress.textContent=message;
    progress.classList.toggle('show',show);
  };
  const safeText=(value,fallback='')=>typeof value==='string'&&value.trim()?value.trim():fallback;
  const trackEvent=(name,params={})=>{
    if(typeof window.gtag!=='function')return;
    window.gtag('event',name,params);
  };

  const downloadUrl=(sourceUrl,index)=>`${INSTAGRAM_DOWNLOAD_API}?url=${encodeURIComponent(sourceUrl)}&item=${index}`;

  const triggerDownload=(sourceUrl,index)=>{
    const anchor=document.createElement('a');
    anchor.href=downloadUrl(sourceUrl,index);
    anchor.download='';
    anchor.style.display='none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  };

  const triggerBlobDownload=(blob,filename)=>{
    const objectUrl=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=objectUrl;
    anchor.download=filename;
    anchor.style.display='none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
  };

  const startDownload=async(sourceUrl,index,mediaType,control)=>{
    if(!sourceUrl){setStatus('The original Instagram post URL is missing. Resolve the post again.','error');return;}
    trackEvent('download_instagram',{media_type:mediaType,item_index:index,delivery:'cloudflare'});
    const oldText=control.textContent;
    control.disabled=true;
    control.textContent='Preparing…';
    setProgress(`Checking ${mediaType} ${index+1}…`);
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),60000);
    try{
      const response=await fetch(downloadUrl(sourceUrl,index),{cache:'no-store',signal:controller.signal});
      if(!response.ok){
        let detail='';
        try{detail=(await response.json())?.error||'';}catch{}
        throw new Error(detail||`Instagram download returned HTTP ${response.status}. Resolve the post again and retry.`);
      }
      const type=(response.headers.get('content-type')||'').toLowerCase();
      if(!/^(image\/|video\/|application\/octet-stream)/.test(type)){
        throw new Error('Instagram did not return a supported media file.');
      }
      const maxBytes=48*1024*1024;
      const statedSize=Number(response.headers.get('content-length')||0);
      if(statedSize>maxBytes){
        await response.body?.cancel();
        triggerDownload(sourceUrl,index);
        setProgress('Large media file: download handed to your browser. Check Downloads for the result.');
        trackEvent('download_browser_handoff',{platform:'instagram',media_type:mediaType});
        return;
      }
      const reader=response.body?.getReader();
      if(!reader)throw new Error('Instagram returned an empty download response.');
      const parts=[];
      let total=0;
      while(true){
        const {value,done}=await reader.read();
        if(done)break;
        total+=value.byteLength;
        if(total>maxBytes){
          await reader.cancel();
          triggerDownload(sourceUrl,index);
          setProgress('Large media file: download handed to your browser. Check Downloads for the result.');
          trackEvent('download_browser_handoff',{platform:'instagram',media_type:mediaType});
          return;
        }
        parts.push(value);
      }
      if(!total)throw new Error('The Instagram download was empty. Resolve the post again.');
      const ext=extensionFor(type,mediaType);
      triggerBlobDownload(new Blob(parts,{type}),`instagram-${index+1}.${ext}`);
      setProgress('Media received and handed to your browser. Check Downloads to confirm it was saved.');
      trackEvent('download_response_ok',{platform:'instagram',media_type:mediaType});
    }catch(error){
      const detail=error?.name==='AbortError'?'The media request took too long. Resolve the original post and retry.':error instanceof Error?error.message:'Instagram download failed.';
      setStatus(detail,'error');
      setProgress(detail);
      trackEvent('download_failed',{platform:'instagram',reason:error?.name==='AbortError'?'timeout':'response_error'});
    }finally{
      clearTimeout(timeout);
      control.disabled=false;
      control.textContent=oldText;
    }
  };

  const validInstagramSource=(value)=>{
    try{
      const url=new URL(value);
      const host=url.hostname.toLowerCase();
      return url.protocol==='https:'&&(host==='instagram.com'||host.endsWith('.instagram.com'))?url.toString():null;
    }catch{return null;}
  };

  const createChip=(label,value)=>{
    const chip=document.createElement('span');
    chip.className='media-chip';
    if(value===undefined){chip.textContent=label;return chip;}
    const labelNode=document.createTextNode(`${label} `);
    const strong=document.createElement('strong');
    strong.textContent=String(value);
    chip.append(labelNode,strong);
    return chip;
  };

  const createPreview=(item,index)=>{
    const preview=document.createElement('div');
    preview.className='media-card-preview';

    const badge=document.createElement('span');
    badge.className='media-card-badge';
    badge.textContent=item.type==='video'?'Video':'Photo';
    preview.append(badge);

    const number=document.createElement('span');
    number.className='media-card-number';
    number.textContent=String(index+1);
    preview.append(number);

    const previewUrl=safeText(item.previewUrl,item.type==='image'?safeText(item.url,''):'');
    if(previewUrl){
      const image=document.createElement('img');
      image.src=previewUrl;
      image.alt=`Instagram ${item.type} item ${index+1}`;
      image.loading='lazy';
      image.decoding='async';
      image.referrerPolicy='no-referrer';
      image.addEventListener('error',()=>{image.hidden=true;preview.classList.add('media-preview-unavailable');},{once:true});
      preview.append(image);
    }else{
      const empty=document.createElement('div');
      empty.className='media-empty';
      empty.textContent=item.type==='video'?'Video preview unavailable':'Preview unavailable';
      preview.append(empty);
    }
    return preview;
  };

  const createMediaCard=(item,index,data)=>{
    const card=document.createElement('article');
    card.className='media-card';
    card.append(createPreview(item,index));

    const body=document.createElement('div');
    body.className='media-card-body';
    const heading=document.createElement('p');
    heading.className='media-card-title';
    heading.textContent=`${item.type==='video'?'Video':'Photo'} ${index+1} of ${data.media.length}`;
    body.append(heading);

    const actions=document.createElement('div');
    actions.className='media-card-actions';
    const downloadButton=document.createElement('button');
    downloadButton.type='button';
    downloadButton.className='media-button primary';
    downloadButton.textContent=item.type==='video'?'Download video':'Download photo';
    downloadButton.addEventListener('click',()=>{
      if(downloadButton.disabled)return;
      startDownload(data.sourceUrl,index,item.type,downloadButton);
    });
    actions.append(downloadButton);
    body.append(actions);
    card.append(body);
    return card;
  };

  const getCrcTable=()=>{
    if(crcTable)return crcTable;
    crcTable=new Uint32Array(256);
    for(let n=0;n<256;n+=1){
      let c=n;
      for(let k=0;k<8;k+=1)c=(c&1)?0xedb88320^(c>>>1):c>>>1;
      crcTable[n]=c>>>0;
    }
    return crcTable;
  };

  const crc32=(bytes)=>{
    const table=getCrcTable();
    let crc=0xffffffff;
    for(let i=0;i<bytes.length;i+=1)crc=table[(crc^bytes[i])&0xff]^(crc>>>8);
    return (crc^0xffffffff)>>>0;
  };

  const dosDateTime=(date=new Date())=>{
    const year=Math.max(1980,date.getFullYear());
    return {
      time:((date.getHours()&31)<<11)|((date.getMinutes()&63)<<5)|((Math.floor(date.getSeconds()/2))&31),
      date:(((year-1980)&127)<<9)|(((date.getMonth()+1)&15)<<5)|(date.getDate()&31)
    };
  };

  const zipLocalHeader=(entry)=>{
    const header=new Uint8Array(30+entry.nameBytes.length);
    const view=new DataView(header.buffer);
    view.setUint32(0,0x04034b50,true);
    view.setUint16(4,20,true);
    view.setUint16(6,0x0800,true);
    view.setUint16(8,0,true);
    view.setUint16(10,entry.time,true);
    view.setUint16(12,entry.date,true);
    view.setUint32(14,entry.crc,true);
    view.setUint32(18,entry.size,true);
    view.setUint32(22,entry.size,true);
    view.setUint16(26,entry.nameBytes.length,true);
    view.setUint16(28,0,true);
    header.set(entry.nameBytes,30);
    return header;
  };

  const zipCentralHeader=(entry)=>{
    const header=new Uint8Array(46+entry.nameBytes.length);
    const view=new DataView(header.buffer);
    view.setUint32(0,0x02014b50,true);
    view.setUint16(4,20,true);
    view.setUint16(6,20,true);
    view.setUint16(8,0x0800,true);
    view.setUint16(10,0,true);
    view.setUint16(12,entry.time,true);
    view.setUint16(14,entry.date,true);
    view.setUint32(16,entry.crc,true);
    view.setUint32(20,entry.size,true);
    view.setUint32(24,entry.size,true);
    view.setUint16(28,entry.nameBytes.length,true);
    view.setUint16(30,0,true);
    view.setUint16(32,0,true);
    view.setUint16(34,0,true);
    view.setUint16(36,0,true);
    view.setUint32(38,0,true);
    view.setUint32(42,entry.offset,true);
    header.set(entry.nameBytes,46);
    return header;
  };

  const zipEndRecord=(entryCount,centralSize,centralOffset)=>{
    const record=new Uint8Array(22);
    const view=new DataView(record.buffer);
    view.setUint32(0,0x06054b50,true);
    view.setUint16(4,0,true);
    view.setUint16(6,0,true);
    view.setUint16(8,entryCount,true);
    view.setUint16(10,entryCount,true);
    view.setUint32(12,centralSize,true);
    view.setUint32(16,centralOffset,true);
    view.setUint16(20,0,true);
    return record;
  };

  const extensionFor=(contentType,mediaType)=>{
    const type=(contentType||'').toLowerCase();
    if(type.includes('video/mp4'))return 'mp4';
    if(type.includes('image/png'))return 'png';
    if(type.includes('image/webp'))return 'webp';
    if(type.includes('image/avif'))return 'avif';
    return mediaType==='video'?'mp4':'jpg';
  };

  const safeId=(value)=>String(value||'post').replace(/[^0-9A-Za-z_-]/g,'')||'post';

  const buildZip=async(data)=>{
    const encoder=new TextEncoder();
    const entries=[];
    let offset=0;
    let totalSize=0;
    const maxZipBytes=64*1024*1024;
    const maxItemBytes=32*1024*1024;

    for(let index=0;index<data.media.length;index+=1){
      setProgress(`Fetching item ${index+1} of ${data.media.length} for ZIP…`);
      const response=await fetch(downloadUrl(data.sourceUrl,index),{cache:'no-store',signal:AbortSignal.timeout(60000)});
      if(!response.ok){
        let detail='';
        try{detail=(await response.json())?.error||'';}catch{}
        throw new Error(detail||`Could not fetch item ${index+1}.`);
      }
      const type=(response.headers.get('content-type')||'').toLowerCase();
      if(!/^(video\/|image\/|application\/octet-stream)/.test(type)){
        await response.body?.cancel();
        throw new Error(`Item ${index+1} did not return a supported media file.`);
      }
      const statedSize=Number(response.headers.get('content-length')||0);
      if(statedSize>maxItemBytes||totalSize+statedSize>maxZipBytes){
        await response.body?.cancel();
        throw new Error('This carousel is too large for a browser ZIP. Download items individually.');
      }
      const reader=response.body?.getReader();
      if(!reader)throw new Error(`Item ${index+1} returned no media data.`);
      const chunks=[];
      let itemSize=0;
      while(true){
        const {value,done}=await reader.read();
        if(done)break;
        itemSize+=value.byteLength;
        if(itemSize>maxItemBytes||totalSize+itemSize>maxZipBytes){
          await reader.cancel();
          throw new Error('This carousel exceeds the browser ZIP memory limit. Download items individually.');
        }
        chunks.push(value);
      }
      if(!itemSize)throw new Error(`Item ${index+1} returned an empty media file.`);
      const blob=new Blob(chunks,{type});
      if(blob.size>ZIP32_MAX)throw new Error(`Item ${index+1} is too large for a standard ZIP. Download it individually.`);
      totalSize+=blob.size;
      if(totalSize>ZIP32_MAX)throw new Error('This carousel is too large for one ZIP. Download the items individually.');
      const bytes=new Uint8Array(await blob.arrayBuffer());
      const ext=extensionFor(type,data.media[index].type);
      const filename=`instagram-${safeId(data.id)}-${String(index+1).padStart(2,'0')}.${ext}`;
      const nameBytes=encoder.encode(filename);
      const stamp=dosDateTime();
      const entry={blob,nameBytes,size:blob.size,crc:crc32(bytes),time:stamp.time,date:stamp.date,offset};
      entries.push(entry);
      offset+=30+nameBytes.length+blob.size;
      if(offset>ZIP32_MAX)throw new Error('This carousel is too large for one ZIP. Download the items individually.');
    }

    const parts=[];
    for(const entry of entries){parts.push(zipLocalHeader(entry),entry.blob);}
    const centralOffset=offset;
    let centralSize=0;
    for(const entry of entries){
      const header=zipCentralHeader(entry);
      parts.push(header);
      centralSize+=header.length;
    }
    parts.push(zipEndRecord(entries.length,centralSize,centralOffset));
    return new Blob(parts,{type:'application/zip'});
  };

  const resetResult=()=>{
    currentData=null;
    result.classList.remove('show');
    gallery.replaceChildren();
    chips.replaceChildren();
    downloadAllButton.hidden=true;
    downloadAllButton.disabled=false;
    openOriginal.hidden=true;
    openOriginal.removeAttribute('href');
    setProgress('',false);
  };

  const render=(data)=>{
    const media=Array.isArray(data.media)?data.media.filter((item)=>item&&['image','video'].includes(item.type)):[];
    if(!media.length){setStatus('No downloadable public Instagram media was found.','error');return;}

    currentData={...data,media};
    const mediaTitle=safeText(data.title,'Instagram post');
    title.textContent=mediaTitle;
    author.textContent=safeText(data.author,'Instagram creator');
    if(data.cover){
      cover.src=data.cover;
      cover.alt=`Preview of ${mediaTitle}`;
      cover.hidden=false;
      cover.referrerPolicy='no-referrer';
    }else{
      cover.hidden=true;
      cover.removeAttribute('src');
    }

    const imageCount=media.filter((item)=>item.type==='image').length;
    const videoCount=media.filter((item)=>item.type==='video').length;
    const typeLabel=media.length>1?'Carousel':media[0].type==='video'?'Video':'Photo';
    chips.replaceChildren(createChip(typeLabel),createChip('Items',media.length));
    if(imageCount)chips.append(createChip('Photos',imageCount));
    if(videoCount)chips.append(createChip('Videos',videoCount));
    summary.textContent=media.length===1?`1 public ${media[0].type} resolved.`:`${media.length} public media items resolved from this carousel.`;

    gallery.replaceChildren(...media.map((item,index)=>createMediaCard(item,index,currentData)));

    const source=validInstagramSource(data.sourceUrl);
    if(source){
      openOriginal.href=source;
      openOriginal.hidden=false;
    }else{
      openOriginal.hidden=true;
    }

    downloadAllButton.hidden=media.length<2;
    downloadAllButton.textContent=`Download all (.zip)`;
    setProgress('',false);
    result.classList.add('show');
    result.scrollIntoView({behavior:'smooth',block:'nearest'});
  };

  downloadAllButton.addEventListener('click',async()=>{
    if(!currentData||downloadAllButton.disabled||currentData.media.length<2)return;
    downloadAllButton.disabled=true;
    const oldText=downloadAllButton.textContent;
    downloadAllButton.textContent='Preparing ZIP…';
    trackEvent('download_instagram_all',{
      media_count:currentData.media.length,
      image_count:currentData.media.filter((item)=>item.type==='image').length,
      video_count:currentData.media.filter((item)=>item.type==='video').length,
      delivery:'cloudflare',
      format:'zip'
    });
    try{
      const zip=await buildZip(currentData);
      setProgress('ZIP ready. Starting download…');
      triggerBlobDownload(zip,`instagram-${safeId(currentData.id)}.zip`);
      setProgress(`ZIP prepared with ${currentData.media.length} items. Check your browser downloads to confirm it was saved.`);
      trackEvent('download_response_ok',{platform:'instagram',format:'zip',media_count:currentData.media.length});
    }catch(error){
      const message=error?.name==='TimeoutError'?'An Instagram item timed out. Try downloading available items individually.':error instanceof Error?error.message:'Unable to create the ZIP download.';
      setProgress(message);
      setStatus(message,'error');
      trackEvent('download_failed',{platform:'instagram',format:'zip',reason:error?.name==='TimeoutError'?'timeout':'zip_error'});
    }finally{
      downloadAllButton.disabled=false;
      downloadAllButton.textContent=oldText;
    }
  });

  form.addEventListener('submit',async(event)=>{
    event.preventDefault();
    const url=input.value.trim();
    if(!url){setStatus('Paste an Instagram post or Reel link first.','error');return;}
    button.disabled=true;
    resetResult();
    setStatus('Checking the public Instagram link…','loading');
    try{
      const response=await fetch('/api/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url}),signal:AbortSignal.timeout(35000)});
      const payload=await response.json().catch(()=>({ok:false,error:`Resolver returned an unexpected response (HTTP ${response.status}). Please retry.` }));
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Unable to resolve this Instagram link.');
      if(payload.data?.platform!=='instagram')throw new Error('This page accepts Instagram links only.');
      trackEvent('resolve_success',{platform:'instagram',media_type:payload.data?.type||'unknown',media_count:Array.isArray(payload.data?.media)?payload.data.media.length:0});
      clearStatus();
      render(payload.data);
    }catch(error){
      trackEvent('resolve_failed',{platform:'instagram'});
      setStatus(error?.name==='TimeoutError'?'The platform did not respond in time. Please retry with the original post URL.':error instanceof Error?error.message:'Something went wrong. Please try again.','error');
    }finally{
      button.disabled=false;
    }
  });
}
