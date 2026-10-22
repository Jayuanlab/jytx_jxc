(function(){
  let stream=null;
  let active=false;
  let sequence=0;
  let detector=null;
  function element(id){return document.getElementById(id);}
  function status(message,error){
    const target=element('sale-scan-status');
    if(!target)return;
    target.textContent=message;
    target.classList.toggle('error',Boolean(error));
  }
  function stop(){
    active=false;
    sequence++;
    if(stream)stream.getTracks().forEach(function(track){track.stop();});
    stream=null;
    const video=element('sale-camera-preview');
    if(video){video.pause();video.srcObject=null;video.hidden=true;}
    const button=element('sale-camera-button');
    if(button)button.textContent='扫码';
  }
  function barcodeDetector(){
    if(!('BarcodeDetector' in window))return null;
    if(!detector){try{detector=new BarcodeDetector();}catch{return null;}}
    return detector;
  }
  async function readCode(source){
    const nativeDetector=barcodeDetector();
    if(nativeDetector){
      try{
        const values=await nativeDetector.detect(source);
        if(values.length && values[0].rawValue)return String(values[0].rawValue).trim();
      }catch{}
    }
    if(typeof window.jsQR!=='function')return '';
    const width=source.videoWidth||source.naturalWidth||source.width;
    const height=source.videoHeight||source.naturalHeight||source.height;
    if(!width||!height)return '';
    const canvas=document.createElement('canvas');
    const ratio=Math.min(1,1800/Math.max(width,height));
    canvas.width=Math.max(1,Math.round(width*ratio));
    canvas.height=Math.max(1,Math.round(height*ratio));
    const context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context)return '';
    context.drawImage(source,0,0,canvas.width,canvas.height);
    const pixels=context.getImageData(0,0,canvas.width,canvas.height);
    const result=window.jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'attemptBoth'});
    return result && result.data ? String(result.data).trim() : '';
  }
  async function startCamera(onCode){
    if(active){stop();status('已关闭相机。');return;}
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      status('此浏览器不能打开相机，请拍照识码或手动选择商品。',true);return;
    }
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      const video=element('sale-camera-preview');
      if(!video){stop();return;}
      video.srcObject=stream;video.hidden=false;
      await video.play();
      active=true;
      const run=++sequence;
      element('sale-camera-button').textContent='关闭扫码';
      status('将商品二维码、条码或手机串码条码放进取景框。');
      let last=0;
      async function frame(time){
        if(!active||run!==sequence)return;
        if(time-last>280&&video.videoWidth){
          last=time;
          const found=await readCode(video);
          if(!active||run!==sequence)return;
          if(found){stop();status('已识别：'+found);onCode(found);return;}
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }catch{
      stop();status('相机未打开。请允许相机权限，或用拍照、下拉选择商品。',true);
    }
  }
  async function readPhoto(file,onCode){
    if(!file)return;
    stop();
    let image=null;
    try{
      image=await createImageBitmap(file);
      const found=await readCode(image);
      if(found){status('照片识别到：'+found);onCode(found);}
      else status('照片中未识别到二维码或条码。纯文字请用名称搜索或下拉选择。',true);
    }catch{status('照片无法识别，请换一张清晰照片。',true);}
    finally{if(image)image.close();const input=element('sale-photo-input');if(input)input.value='';}
  }
  window.SaleCapture={
    decode:readCode,
    mount:function(onCode){
      stop();
      const camera=element('sale-camera-button');
      const photo=element('sale-photo-button');
      const input=element('sale-photo-input');
      if(!camera||!photo||!input)return;
      camera.addEventListener('click',function(){startCamera(onCode);});
      photo.addEventListener('click',function(){input.click();});
      input.addEventListener('change',function(){readPhoto(input.files[0],onCode);});
    },
    stop:stop
  };
  window.addEventListener('pagehide',stop);
})();