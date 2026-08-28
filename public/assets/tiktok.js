const form=document.querySelector('[data-tiktok-downloader-form]');
if(form){
  const input=form.querySelector('input[name="url"]');
  const button=form.querySelector('button[type="submit"]');
  const status=document.querySelector('[data-status]');
  const result=document.querySelector('[data-result]');

  const setStatus=(message,type)=>{
    status.textContent=message;
    status.className=`status show ${type||''}`;
  };

  const clearStatus=()=>{status.textContent='';status.className='status';};
  const safeText=(value,fallback='')=>typeof value==='string'&&value.trim()?value.trim():fallback;

  const safeFilename=(value,extension)=>{
    const base=safeText(value,'tiktok-video')
      .replace(/[\\/:*?"<>|\u0000-\u001F]/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .slice(0,120)||'tiktok-video';
    return `${base}.${extension}`;
  };

  const downloadDirect=async(url,filename,control)=>{
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
      setStatus('Direct download was blocked by the media server. Opening the video instead.','error');
      window.open(url,'_blank','noopener,noreferrer');
    }finally{
      control.disabled=false;
      control.textContent=oldText;
    }
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
    if(!url){setStatus('Paste a TikTok link first.','error');return;}
    button.disabled=true;
    result.classList.remove('show');
    setStatus('Checking the public TikTok link…','loading');
    try{
      const response=await fetch('/api/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});
      const payload=await response.json();
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Unable to resolve this TikTok link.');
      if(payload.data?.platform!=='tiktok')throw new Error('This page accepts TikTok links only.');
      clearStatus();
      render(payload.data);
    }catch(error){
      setStatus(error instanceof Error?error.message:'Something went wrong. Please try again.','error');
    }finally{
      button.disabled=false;
    }
  });
}
