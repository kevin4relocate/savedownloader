const form=document.querySelector('[data-downloader-form]');
if(form){
  const input=form.querySelector('input[name="url"]');
  const button=form.querySelector('button[type="submit"]');
  const status=document.querySelector('[data-status]');
  const result=document.querySelector('[data-result]');
  const TIKTOK_DOWNLOAD_API='https://savedownloader-tiktok-api.vercel.app/api/download';

  const setStatus=(message,type)=>{
    status.textContent=message;
    status.className=`status show ${type||''}`;
  };

  const clearStatus=()=>{status.textContent='';status.className='status';};

  const safeText=(value,fallback='')=>typeof value==='string'&&value.trim()?value.trim():fallback;

  const platformName=(platform)=>platform==='tiktok'?'TikTok':platform==='douyin'?'Douyin':'Public';

  const trackEvent=(name,params={})=>{
    if(typeof window.gtag!=='function')return;
    window.gtag('event',name,params);
  };

  const guessPlatform=(value)=>{
    try{
      const host=new URL(value).hostname.toLowerCase();
      if(host==='tiktok.com'||host.endsWith('.tiktok.com'))return 'tiktok';
      if(host==='douyin.com'||host.endsWith('.douyin.com')||host==='iesdouyin.com'||host.endsWith('.iesdouyin.com'))return 'douyin';
    }catch{}
    return 'unknown';
  };

  const safeFilename=(value,extension)=>{
    const base=safeText(value,'savedownloader-media')
      .replace(/[\\/:*?"<>|\u0000-\u001F]/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .slice(0,120)||'savedownloader-media';
    return `${base}.${extension}`;
  };

  const isIOS=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||
    (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  let pendingMobileUrl=null;
  const saveLink=(url,filename,message,isBlob=false)=>{
    if(pendingMobileUrl){URL.revokeObjectURL(pendingMobileUrl);pendingMobileUrl=null;}
    if(isBlob)pendingMobileUrl=url;
    setStatus(message,'');
    const link=document.createElement('a');
    link.href=url;
    link.textContent='Save file';
    link.className='action mobile-save-link';
    if(filename)link.download=filename;
    if(isBlob)link.addEventListener('click',()=>{
      setTimeout(()=>{
        if(pendingMobileUrl===url){URL.revokeObjectURL(url);pendingMobileUrl=null;}
      },120000);
    },{once:true});
    status.append(' ',link);
  };
  const startBackendDownload=async(url,control,message,platform)=>{
    const oldText=control.textContent;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),60000);
    control.disabled=true;
    control.textContent='Preparing download…';
    setStatus(message,'loading');
    const handoff=()=>{
      if(isIOS())saveLink(url,null,'Large file: tap Save file to open Safari Downloads.');
      else {
        const link=document.createElement('a');
        link.href=url;
        link.hidden=true;
        document.body.append(link);
        link.click();
        link.remove();
        setStatus('Large file: download handed to your browser. Check Downloads to confirm the result.','');
      }
      trackEvent('download_browser_handoff',{platform});
    };
    try{
      const response=await fetch(url,{signal:controller.signal,credentials:'omit'});
      if(!response.ok){
        let detail='';
        try{detail=(await response.json())?.error||'';}catch{}
        throw new Error(detail||`Download service returned HTTP ${response.status}. Retry with the original post link.`);
      }
      const type=(response.headers.get('content-type')||'').toLowerCase();
      if(!/^(video\/|application\/octet-stream)/.test(type))throw new Error('The source did not return a supported video file.');
      const limit=48*1024*1024;
      if(Number(response.headers.get('content-length')||0)>limit){
        await response.body?.cancel();
        handoff();
        return;
      }
      const reader=response.body?.getReader();
      if(!reader)throw new Error('The download response has no file data.');
      const chunks=[];
      let size=0;
      while(true){
        const {value,done}=await reader.read();
        if(done)break;
        size+=value.byteLength;
        if(size>limit){await reader.cancel();handoff();return;}
        chunks.push(value);
      }
      if(!size)throw new Error('The source returned an empty video file.');
      const fileUrl=URL.createObjectURL(new Blob(chunks,{type}));
      if(isIOS())saveLink(fileUrl,`${platform}-video.mp4`,'Video ready. Tap Save file and check Safari Downloads or Files.',true);
      else {
        const link=document.createElement('a');
        link.href=fileUrl;
        link.download=`${platform}-video.mp4`;
        link.hidden=true;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(()=>URL.revokeObjectURL(fileUrl),30000);
        setStatus('File handed to your browser. Check Downloads to confirm it was saved.','');
      }
      trackEvent('download_response_ok',{platform,delivery:platform==='tiktok'?'vercel':'cloudflare'});
    }catch(error){
      const timeoutError=error?.name==='AbortError'||error?.name==='TimeoutError';
      setStatus(timeoutError?'Download timed out. Please retry the original link.':error instanceof Error?error.message:'Download failed. Try again.','error');
      trackEvent('download_failed',{platform,reason:timeoutError?'timeout':'response_error'});
    }finally{
      clearTimeout(timeout);
      control.disabled=false;
      control.textContent=oldText;
    }
  };
  const downloadDirect=async(url,filename,control,fallback)=>{
    const oldText=control.textContent;
    control.disabled=true;
    control.textContent='Preparing download…';
    setStatus('Preparing the file from the media server…','loading');
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),45000);
    try{
      const response=await fetch(url,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
      if(!response.ok)throw new Error(`Media server returned HTTP ${response.status}.`);
      const contentType=(response.headers.get('content-type')||'').toLowerCase();
      if(!/^(video\/|application\/octet-stream)/.test(contentType)){
        throw new Error('The upstream server did not return a video file.');
      }
      const maxBytes=48*1024*1024;
      const statedSize=Number(response.headers.get('content-length')||0);
      if(statedSize>maxBytes)throw new Error('The file is too large for in-browser handling.');
      const reader=response.body?.getReader();
      if(!reader)throw new Error('The media server returned no file data.');
      const chunks=[];
      let total=0;
      while(true){
        const {value,done}=await reader.read();
        if(done)break;
        total+=value.byteLength;
        if(total>maxBytes){await reader.cancel();throw new Error('The file is too large for in-browser handling.');}
        chunks.push(value);
      }
      if(!total)throw new Error('The media server returned an empty file.');
      const objectUrl=URL.createObjectURL(new Blob(chunks,{type:contentType}));
      const anchor=document.createElement('a');
      anchor.href=objectUrl;
      anchor.download=filename;
      anchor.hidden=true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
      setStatus('Video received and handed to your browser. Check Downloads to confirm it was saved.','');
      trackEvent('download_response_ok',{platform:'douyin',delivery:'direct'});
    }catch(error){
      if(typeof fallback==='function'){
        control.disabled=false;
        control.textContent=oldText;
        fallback();
        return;
      }
      setStatus(error?.name==='AbortError'?'The media server timed out. Please retry.':error instanceof Error?error.message:'Direct download failed.','error');
      trackEvent('download_failed',{platform:'douyin',reason:error?.name==='AbortError'?'timeout':'response_error'});
    }finally{
      clearTimeout(timeout);
      if(control.disabled){
        control.disabled=false;
        control.textContent=oldText;
      }
    }
  };

  const downloadTikTokViaBackend=(sourceUrl,control)=>{
    if(!sourceUrl){setStatus('The original TikTok post URL is missing. Resolve the post again.','error');return;}
    startBackendDownload(
      `${TIKTOK_DOWNLOAD_API}?url=${encodeURIComponent(sourceUrl)}`,
      control,
      'Preparing the TikTok video for download…',
      'tiktok'
    );
  };

  const downloadDouyinViaBackend=(sourceUrl,control)=>{
    if(!sourceUrl){setStatus('The original Douyin post URL is missing. Resolve the post again.','error');return;}
    startBackendDownload(
      `/api/download/douyin?url=${encodeURIComponent(sourceUrl)}`,
      control,
      'Douyin blocked the direct media request. Retrying through SaveDownloader…',
      'douyin'
    );
  };

  const render=(data)=>{
    const cover=result.querySelector('[data-cover]');
    const title=result.querySelector('[data-title]');
    const author=result.querySelector('[data-author]');
    const actions=result.querySelector('[data-actions]');
    const platform=platformName(data.platform);
    const mediaTitle=safeText(data.title,`${platform} media`);
    title.textContent=mediaTitle;
    author.textContent=safeText(data.author,`${platform} creator`);
    if(data.cover){cover.src=data.cover;cover.alt=`Preview of ${mediaTitle}`;cover.hidden=false;}else{cover.hidden=true;}
    actions.replaceChildren();

    if(data.videoUrl){
      const downloadButton=document.createElement('button');
      downloadButton.type='button';
      downloadButton.className='action';
      downloadButton.textContent='Download video';
      downloadButton.addEventListener('click',()=>{
        if(downloadButton.disabled)return;
        if(data.platform==='tiktok'){
          trackEvent('download_tiktok',{media_type:'video',delivery:'vercel'});
          downloadTikTokViaBackend(data.sourceUrl,downloadButton);
          return;
        }
        if(data.platform==='douyin'){
          trackEvent('download_douyin',{media_type:'video',delivery:'direct_with_cloudflare_fallback'});
          if(isIOS())downloadDouyinViaBackend(data.sourceUrl,downloadButton);
          else downloadDirect(
            data.videoUrl,
            safeFilename(mediaTitle,'mp4'),
            downloadButton,
            ()=>downloadDouyinViaBackend(data.sourceUrl,downloadButton)
          );
          return;
        }
        downloadDirect(data.videoUrl,safeFilename(mediaTitle,'mp4'),downloadButton);
      });
      actions.append(downloadButton);
    }
    if(Array.isArray(data.images)){
      data.images.forEach((url,index)=>{
        const link=document.createElement('a');
        link.className='action secondary';
        link.href=url;
        link.target='_blank';
        link.rel='noopener noreferrer';
        link.textContent=`Open image ${index+1}`;
        actions.append(link);
      });
    }
    result.classList.add('show');
  };

  form.addEventListener('submit',async(event)=>{
    event.preventDefault();
    const url=input.value.trim();
    if(!url){setStatus('Paste a public Douyin or TikTok link first.','error');return;}
    const requestedPlatform=guessPlatform(url);
    button.disabled=true;
    result.classList.remove('show');
    setStatus('Checking the public media link…','loading');
    try{
      const response=await fetch('/api/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url}),signal:AbortSignal.timeout(35000)});
      const payload=await response.json().catch(()=>({ok:false,error:`Resolver returned an unexpected response (HTTP ${response.status}). Please retry.` }));
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Unable to resolve this link.');
      trackEvent('resolve_success',{
        platform:payload.data?.platform||requestedPlatform,
        media_type:payload.data?.type||'unknown'
      });
      clearStatus();
      render(payload.data);
    }catch(error){
      trackEvent('resolve_failed',{platform:requestedPlatform});
      setStatus(error?.name==='TimeoutError'?'The platform did not respond in time. Please retry with the original post URL.':error instanceof Error?error.message:'Something went wrong. Please try again.','error');
    }finally{button.disabled=false;}
  });
}
