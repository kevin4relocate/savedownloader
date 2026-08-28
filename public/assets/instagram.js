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
  const INSTAGRAM_DOWNLOAD_API='https://savedownloader-instagram-api.vercel.app/api/download';
  let currentData=null;

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
  const delay=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

  const downloadUrl=(sourceUrl,index)=>`${INSTAGRAM_DOWNLOAD_API}?url=${encodeURIComponent(sourceUrl)}&item=${index}`;

  const triggerDownload=(sourceUrl,index)=>{
    const anchor=document.createElement('a');
    anchor.href=downloadUrl(sourceUrl,index);
    anchor.style.display='none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  };

  const startDownload=(sourceUrl,index,mediaType,control)=>{
    if(!sourceUrl){setStatus('The original Instagram post URL is missing. Resolve the post again.','error');return;}
    trackEvent('download_instagram',{media_type:mediaType,item_index:index});
    const oldText=control.textContent;
    control.disabled=true;
    control.textContent='Starting…';
    setProgress(`Preparing ${mediaType} ${index+1} for download…`);
    triggerDownload(sourceUrl,index);
    setTimeout(()=>{
      setProgress('Download started. If nothing happens, allow downloads for this site and try again.');
      control.disabled=false;
      control.textContent=oldText;
    },1200);
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
    downloadAllButton.textContent=`Download all ${media.length}`;
    setProgress('',false);
    result.classList.add('show');
    result.scrollIntoView({behavior:'smooth',block:'nearest'});
  };

  downloadAllButton.addEventListener('click',async()=>{
    if(!currentData||downloadAllButton.disabled)return;
    const media=currentData.media;
    const sourceUrl=currentData.sourceUrl;
    if(!sourceUrl||!media.length)return;

    downloadAllButton.disabled=true;
    const oldText=downloadAllButton.textContent;
    trackEvent('download_instagram_all',{
      media_count:media.length,
      image_count:media.filter((item)=>item.type==='image').length,
      video_count:media.filter((item)=>item.type==='video').length
    });

    for(let index=0;index<media.length;index+=1){
      setProgress(`Starting download ${index+1} of ${media.length}… Your browser may ask to allow multiple downloads.`);
      triggerDownload(sourceUrl,index);
      if(index<media.length-1)await delay(650);
    }

    setProgress(`Started ${media.length} downloads. If your browser blocked some files, allow multiple downloads and use the item buttons for any missing files.`);
    downloadAllButton.disabled=false;
    downloadAllButton.textContent=oldText;
  });

  form.addEventListener('submit',async(event)=>{
    event.preventDefault();
    const url=input.value.trim();
    if(!url){setStatus('Paste an Instagram post or Reel link first.','error');return;}
    button.disabled=true;
    resetResult();
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
