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

  const startBackendDownload=async(url,control,message,platform)=>{
    const oldText=control.textContent;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),60000);
    control.disabled=true;
    control.textContent='Preparing download…';
    setStatus(message,'loading');
    try{
      const response=await fetch(url,{signal:controller.signal,credentials:'omit'});
      if(!response.ok){
        let details='';
        try{details=(await response.json())?.error||'';}catch{}
        throw new Error(details||`Download service returned HTTP ${response.status}. Please try the original post link again.`);
      }
      const contentType=(response.headers.get('content-type')||'').toLowerCase();
      if(!/^(video\/|image\/|application\/octet-stream)/.test(contentType)){
        throw new Error('The media server did not return a supported file. Resolve the original link again.');
      }
      const maxBrowserBytes=48*1024*1024;
      const statedSize=Number(response.headers.get('content-length')||0);
      const handoff=async()=>{
        await response.body?.cancel();
        const link=document.createElement('a');
        link.href=url;
        link.hidden=true;
        document.body.append(link);
        link.click();
        link.remove();
        setStatus('Large file: download handed to your browser. Check Downloads to confirm the result.','');
        trackEvent('download_browser_handoff',{platform});
      };
      if(statedSize>maxBrowserBytes){await handoff();return;}
      const reader=response.body?.getReader();
      if(!reader)throw new Error('The download response has no file data.');
      const parts=[];
      let total=0;
      while(true){
        const {value,done}=await reader.read();
        if(done)break;
        total+=value.byteLength;
        if(total>maxBrowserBytes){
          await reader.cancel();
          const link=document.createElement('a');
          link.href=url;
          link.hidden=true;
          document.body.append(link);
          link.click();
          link.remove();
          setStatus('Large file: download handed to your browser. Check Downloads to confirm the result.','');
          trackEvent('download_browser_handoff',{platform});
          return;
        }
        parts.push(value);
      }
      if(!total)throw new Error('The media server returned an empty file. Try again.');
      const objectUrl=URL.createObjectURL(new Blob(parts,{type:contentType}));
      const anchor=document.createElement('a');
      anchor.href=objectUrl;
      anchor.download=`${platform}-video.mp4`;
      anchor.hidden=true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
      setStatus('File received and handed to your browser. Check Downloads to confirm it was saved.','');
      trackEvent('download_response_ok',{platform,delivery:platform==='tiktok'?'vercel':'cloudflare'});
    }catch(error){
      const description=error?.name==='AbortError'?'The download took too long. Please retry using the original post link.':error instanceof Error?error.message:'Download failed. Please try again.';
      setStatus(description,'error');
      trackEvent('download_failed',{platform,reason:error?.name==='AbortError'?'timeout':'response_error'});
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
    setStatus('Preparing your download directly from the media server…','loading');
    try{
      const response=await fetch(url,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok)throw new Error(`Media server returned HTTP ${response.status}.`);
      const blob=await response.blob();
      const objectUrl=URL.createObjectURL(blob);
      const anchor=document.createElement('a');
      anchor.href=objectUrl;
      anchor.download=filename;
      anchor.style.display='none';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
      clearStatus();
    }catch(error){
      if(typeof fallback==='function'){
        control.disabled=false;
        control.textContent=oldText;
        fallback();
        return;
      }
      setStatus('Direct download was blocked by the media server. Opening the media instead.','error');
      window.open(url,'_blank','noopener,noreferrer');
    }finally{
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
          downloadDirect(
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
