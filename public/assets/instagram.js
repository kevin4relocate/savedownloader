const form=document.querySelector('[data-instagram-downloader-form]');
if(form){
  const input=form.querySelector('input[name="url"]');
  const button=form.querySelector('button[type="submit"]');
  const status=document.querySelector('[data-status]');
  const result=document.querySelector('[data-result]');
  const INSTAGRAM_DOWNLOAD_API='https://savedownloader-instagram-api.vercel.app/api/download';

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

  const startDownload=(sourceUrl,index,mediaType,control)=>{
    if(!sourceUrl){setStatus('The original Instagram post URL is missing. Resolve the post again.','error');return;}
    trackEvent('download_instagram',{media_type:mediaType,item_index:index});
    const oldText=control.textContent;
    control.disabled=true;
    control.textContent='Starting download…';
    setStatus(`Preparing Instagram ${mediaType} ${index+1}…`,'loading');
    const anchor=document.createElement('a');
    anchor.href=`${INSTAGRAM_DOWNLOAD_API}?url=${encodeURIComponent(sourceUrl)}&item=${index}`;
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

  const render=(data)=>{
    const cover=result.querySelector('[data-cover]');
    const title=result.querySelector('[data-title]');
    const author=result.querySelector('[data-author]');
    const actions=result.querySelector('[data-actions]');
    const media=Array.isArray(data.media)?data.media:[];
    const mediaTitle=safeText(data.title,'Instagram post');
    title.textContent=mediaTitle;
    author.textContent=safeText(data.author,'Instagram creator');
    if(data.cover){cover.src=data.cover;cover.alt=`Preview of ${mediaTitle}`;cover.hidden=false;}else{cover.hidden=true;}
    actions.replaceChildren();

    media.forEach((item,index)=>{
      if(!item||!['image','video'].includes(item.type))return;
      const downloadButton=document.createElement('button');
      downloadButton.type='button';
      downloadButton.className='action';
      const label=media.length>1?`${item.type==='video'?'Download video':'Download image'} ${index+1}`:(item.type==='video'?'Download video':'Download image');
      downloadButton.textContent=label;
      downloadButton.addEventListener('click',()=>{
        if(downloadButton.disabled)return;
        startDownload(data.sourceUrl,index,item.type,downloadButton);
      });
      actions.append(downloadButton);
    });

    if(!actions.children.length){
      setStatus('No downloadable public Instagram media was found.','error');
      return;
    }
    result.classList.add('show');
  };

  form.addEventListener('submit',async(event)=>{
    event.preventDefault();
    const url=input.value.trim();
    if(!url){setStatus('Paste an Instagram post or Reel link first.','error');return;}
    button.disabled=true;
    result.classList.remove('show');
    setStatus('Checking the public Instagram link…','loading');
    try{
      const response=await fetch('/api/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});
      const payload=await response.json();
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Unable to resolve this Instagram link.');
      if(payload.data?.platform!=='instagram')throw new Error('This page accepts Instagram links only.');
      trackEvent('resolve_success',{platform:'instagram',media_type:payload.data?.type||'unknown',media_count:Array.isArray(payload.data?.media)?payload.data.media.length:0});
      clearStatus();
      render(payload.data);
    }catch(error){
      trackEvent('resolve_failed',{platform:'instagram'});
      setStatus(error instanceof Error?error.message:'Something went wrong. Please try again.','error');
    }finally{
      button.disabled=false;
    }
  });
}
