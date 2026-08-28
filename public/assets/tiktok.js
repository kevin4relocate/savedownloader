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

  const startBackendDownload=(url,control,message)=>{
    const oldText=control.textContent;
    control.disabled=true;
    control.textContent='Starting download…';
    setStatus(message,'loading');
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.style.display='none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(()=>{
      clearStatus();
      control.disabled=false;
      control.textContent=oldText;
    },1500);
  };

  const downloadTikTokViaBackend=(sourceUrl,control)=>{
    if(!sourceUrl){setStatus('The original TikTok post URL is missing. Resolve the post again.','error');return;}
    trackEvent('download_tiktok',{media_type:'video',delivery:'vercel'});
    startBackendDownload(
      `${TIKTOK_DOWNLOAD_API}?url=${encodeURIComponent(sourceUrl)}`,
      control,
      'Preparing the TikTok video for download…'
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
