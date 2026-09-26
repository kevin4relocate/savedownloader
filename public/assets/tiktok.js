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
      const response=await fetch('/api/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});
      const payload=await response.json();
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Unable to resolve this TikTok link.');
      if(payload.data?.platform!=='tiktok')throw new Error('This page accepts TikTok links only.');
      trackEvent('resolve_success',{platform:'tiktok',media_type:payload.data?.type||'unknown'});
      clearStatus();
      render(payload.data);
    }catch(error){
      trackEvent('resolve_failed',{platform:'tiktok'});
      setStatus(error instanceof Error?error.message:'Something went wrong. Please try again.','error');
    }finally{
      button.disabled=false;
    }
  });
}
