const form=document.querySelector('[data-downloader-form]');
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

  const render=(data)=>{
    const cover=result.querySelector('[data-cover]');
    const title=result.querySelector('[data-title]');
    const author=result.querySelector('[data-author]');
    const actions=result.querySelector('[data-actions]');
    title.textContent=safeText(data.title,'Douyin media');
    author.textContent=safeText(data.author,'Douyin creator');
    if(data.cover){cover.src=data.cover;cover.alt=`Preview of ${safeText(data.title,'Douyin media')}`;cover.hidden=false;}else{cover.hidden=true;}
    actions.replaceChildren();

    if(data.videoUrl){
      const link=document.createElement('a');
      link.className='action';
      link.href=data.videoUrl;
      link.target='_blank';
      link.rel='noopener noreferrer';
      link.textContent='Download / Open video';
      actions.append(link);
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
    if(!url){setStatus('Paste a Douyin link first.','error');return;}
    button.disabled=true;
    result.classList.remove('show');
    setStatus('Checking the public Douyin link…','loading');
    try{
      const response=await fetch('/api/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});
      const payload=await response.json();
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Unable to resolve this link.');
      clearStatus();
      render(payload.data);
    }catch(error){setStatus(error instanceof Error?error.message:'Something went wrong. Please try again.','error');}
    finally{button.disabled=false;}
  });
}
