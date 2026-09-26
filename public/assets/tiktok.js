const form=document.querySelector('[data-tiktok-downloader-form]');
if(form){
  const input=form.querySelector('input[name="url"]');
  const button=form.querySelector('button[type="submit"]');
  const status=document.querySelector('[data-status]');
  const result=document.querySelector('[data-result]');
  const TIKTOK_DOWNLOAD_API='https://savedownloader-tiktok-api.vercel.app/api/download';

  const hero=form.closest('.hero');
  if(hero)hero.classList.remove('tiktok-hero-compact');
  document.querySelectorAll('style').forEach((style)=>{
    if(style.textContent?.includes('.tiktok-hero-compact'))style.remove();
  });

  const setStatus=(message,type)=>{
    status.textContent=message;
    status.className=`status show ${type||''}`;
  };

  const clearStatus=()=>{status.textContent='';status.className='status';};
  const safeText=(value,fallback='')=>typeof value==='string'&&value.trim()?value.trim():fallback;

  const trackEvent=(name,params={})=>{
    if(typeof window.gtag!=='function')return;
    window.gtag('event',name,params);
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
  const downloadTikTokViaBackend=(sourceUrl,control)=>{
    if(!sourceUrl){setStatus('The original TikTok post URL is missing. Resolve the post again.','error');return;}
    trackEvent('download_tiktok',{media_type:'video',delivery:'vercel'});
    startBackendDownload(
      `${TIKTOK_DOWNLOAD_API}?url=${encodeURIComponent(sourceUrl)}`,
      control,
      'Preparing the TikTok video for download…',
      'tiktok'
    );
  };

  const render=(data)=>{
    const cover=result.querySelector('[data-cover]');
    const title=result.querySelector('[data-title]');
    const author=result.querySelector('[data-author]');
    const actions=result.querySelector('[data-actions]');
    const mediaTitle=safeText(data.title,'TikTok media');
    title.textContent=mediaTitle;
    author.textContent=safeText(data.author,'TikTok creator');
    if(data.cover){cover.src=data.cover;cover.alt=`Preview of ${mediaTitle}`;cover.hidden=false;}else{cover.hidden=true;}
    actions.replaceChildren();

    if(data.videoUrl){
      const downloadButton=document.createElement('button');
      downloadButton.type='button';
      downloadButton.className='action';
      downloadButton.textContent='Download video';
      downloadButton.addEventListener('click',()=>{
        if(downloadButton.disabled)return;
        downloadTikTokViaBackend(data.sourceUrl,downloadButton);
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
    if(!url){setStatus('Paste a TikTok link first.','error');return;}
    button.disabled=true;
    result.classList.remove('show');
    setStatus('Checking the public TikTok link…','loading');
    try{
      const response=await fetch('/api/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url}),signal:AbortSignal.timeout(35000)});
      const payload=await response.json().catch(()=>({ok:false,error:`Resolver returned an unexpected response (HTTP ${response.status}). Please retry.` }));
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Unable to resolve this TikTok link.');
      if(payload.data?.platform!=='tiktok')throw new Error('This page accepts TikTok links only.');
      trackEvent('resolve_success',{platform:'tiktok',media_type:payload.data?.type||'unknown'});
      clearStatus();
      render(payload.data);
    }catch(error){
      trackEvent('resolve_failed',{platform:'tiktok'});
      setStatus(error?.name==='TimeoutError'?'The platform did not respond in time. Please retry with the original post URL.':error instanceof Error?error.message:'Something went wrong. Please try again.','error');
    }finally{
      button.disabled=false;
    }
  });
}
