(()=>{'use strict';if(location.pathname==='/login')return;
const rawFetch=window.fetch.bind(window);
const scope=rawFetch('/api/organization',{credentials:'same-origin',cache:'no-store'}).then(res=>res.ok?res.json():null).catch(()=>null);
window.fetch=async(input,init={})=>{
 const method=String(init.method||(input instanceof Request?input.method:'GET')).toUpperCase();
 const url=new URL(input instanceof Request?input.url:String(input),location.href);
 if(method==='POST'&&url.origin===location.origin&&url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/api/auth/')){
  const data=await scope;if(data?.enabled){const headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(init.headers).forEach((v,k)=>headers.set(k,v));headers.set('X-Store-Branch',data.currentBranchId);init={...init,headers};}
 }
 return rawFetch(input,init);
};
scope.then(data=>{
 if(!data?.enabled)return;const branch=data.branches.find(x=>x.id===data.currentBranchId);if(!branch)return;
 const homeBranch=document.querySelector('body.store-workbench [data-home-branch]');
 if(homeBranch){
  homeBranch.href='/organization';
  const name=homeBranch.querySelector('[data-home-branch-name]');if(name)name.textContent=branch.name;
  homeBranch.title='当前门店：'+branch.code+' '+branch.name+' · 点击切换 / 管理';
  homeBranch.setAttribute('aria-label',homeBranch.title);
  homeBranch.dataset.branchId=branch.id;
  return;
 }
 const bar=document.createElement('div');bar.id='branch-context';bar.style.cssText='font:16px/1.5 system-ui;background:#e9f2ff;color:#19488a;padding:10px 16px;display:flex;gap:12px;justify-content:space-between;position:relative;z-index:2';
 const label=document.createElement('strong');label.textContent='当前门店：'+branch.code+' '+branch.name;bar.append(label);
 const link=document.createElement('a');link.href='/organization';link.textContent='切换 / 管理';bar.append(link);
 const main=document.querySelector('main'),shell=main?.closest('.shell');if(shell)shell.before(bar);else if(main)main.before(bar);else document.body.prepend(bar);
});
})();
