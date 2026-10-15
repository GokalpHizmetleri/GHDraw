(function(root,factory){
  const contract=factory();
  if(typeof module==='object'&&module.exports)module.exports=contract;
  else if(root)root.GHDrawBoardElementContract=contract;
})(typeof globalThis==='object'?globalThis:this,function(){
  const VERSION=1,COORD_LIMIT=1e9,POINT_LIMIT=1e6,MAX_COMMENTS=10000,MAX_ELEMENT_ID_LENGTH=256;
  const FONTS=Object.freeze([
    'Caveat','Kalam','Patrick Hand','Shantell Sans','Playpen Sans','Pangolin','Caveat Brush','Amatic SC',
    'Marck Script','Kaushan Script','Dancing Script','Pacifico','Merienda','Courgette','Lobster','Bangers',
    'Fredoka','Baloo 2','Righteous','Comfortaa','Nunito','Poppins','Inter','Rubik','Oswald','Playfair Display',
    'Lora','Merriweather','Abril Fatface','Cinzel','Courier Prime','Roboto Mono','Space Mono'
  ]);
  const TYPES=Object.freeze(['rect','diamond','ellipse','line','arrow','pen','poly','text','image','video']);
  const FIELDS=Object.freeze(['id','type','x','y','w','h','pts','seed','stroke','bg','fill','sw','style','rough','round','opacity','font','size','align','text','lw','src','giphyId','name','frame','cm','th','ts','au','note','txt','done','pr','b0','b1','g','__bak','__new','__c']);
  const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
  const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const finite=value=>Number.isFinite(value)&&Math.abs(value)<=COORD_LIMIT;
  const validColor=(value,allowTransparent=false)=>typeof value==='string'&&(/^#[0-9a-f]{6}$/i.test(value)||(allowTransparent&&value==='transparent'));
  const validPoints=points=>Array.isArray(points)&&points.length>0&&points.length<=POINT_LIMIT&&points.every(point=>Array.isArray(point)&&(point.length===2||point.length===3)&&finite(point[0])&&finite(point[1])&&(point.length<3||point[2]===null||Number.isFinite(point[2])&&point[2]>=0&&point[2]<=1));
  function validElement(element){
    if(!isObject(element)||Object.keys(element).some(key=>!FIELDS.includes(key))||typeof element.id!=='string'||!element.id||element.id.length>MAX_ELEMENT_ID_LENGTH||!TYPES.includes(element.type))return false;
    const optional=(key,check)=>!own(element,key)||check(element[key]);
    if(!optional('x',finite)||!optional('y',finite)||!optional('w',value=>finite(value)&&value>=0)||!optional('h',value=>finite(value)&&value>=0)||!optional('stroke',value=>validColor(value))||!optional('bg',value=>validColor(value,true))||!optional('fill',value=>['hachure','cross','solid'].includes(value))||!optional('sw',value=>value===null||Number.isFinite(value)&&value>=1&&value<=64)||!optional('style',value=>['solid','dashed','dotted'].includes(value))||!optional('rough',value=>value===null||Number.isFinite(value)&&value>=0&&value<=2)||!optional('round',value=>typeof value==='boolean')||!optional('opacity',value=>value===null||Number.isFinite(value)&&value>=0&&value<=100)||!optional('font',value=>typeof value==='string'&&(FONTS.includes(value)||value==='sans-serif'))||!optional('size',value=>Number.isFinite(value)&&value>=6&&value<=400)||!optional('align',value=>['left','center','right'].includes(value)))return false;
    if(!optional('seed',value=>Number.isSafeInteger(value)&&value>=0&&value<=1e9)||!optional('frame',value=>typeof value==='boolean')||!optional('cm',value=>value===1)||!optional('note',value=>value===1)||!optional('done',value=>typeof value==='boolean')||!optional('pr',value=>typeof value==='boolean')||!optional('__new',value=>typeof value==='boolean')||!optional('__bak',value=>Number.isFinite(value)&&value>=0&&value<=100))return false;
    if(!optional('name',value=>typeof value==='string'&&value.length<=512)||!optional('au',value=>typeof value==='string'&&value.length<=256)||!optional('txt',value=>typeof value==='string'&&value.length<=600)||!optional('text',value=>typeof value==='string'&&value.length<=1e6)||!optional('src',value=>typeof value==='string'&&value.length>0&&value.length<=1e7)||!optional('giphyId',value=>typeof value==='string'&&value.length>0&&value.length<=128)||!optional('g',value=>typeof value==='string'&&value.length<=64)||!optional('b0',value=>typeof value==='string'&&value.length>0&&value.length<=256)||!optional('b1',value=>typeof value==='string'&&value.length>0&&value.length<=256)||!optional('ts',value=>Number.isSafeInteger(value)&&value>=0))return false;
    if(!optional('lw',value=>Array.isArray(value)&&value.length<=POINT_LIMIT&&value.every(number=>Number.isFinite(number)&&number>=0&&number<=1e9))||!optional('__c',value=>Array.isArray(value)&&value.length===2&&value.every(finite)))return false;
    if(!optional('th',messages=>Array.isArray(messages)&&messages.length<=MAX_COMMENTS&&messages.every(message=>isObject(message)&&Object.keys(message).every(key=>['id','n','c','t','ts'].includes(key))&&(!own(message,'id')||typeof message.id==='string'&&message.id.length<=256)&&(!own(message,'n')||typeof message.n==='string'&&message.n.length<=256)&&(!own(message,'c')||typeof message.c==='string'&&(message.c==='inherit'||validColor(message.c)))&&typeof message.t==='string'&&message.t.length<=500&&(!own(message,'ts')||Number.isSafeInteger(message.ts)&&message.ts>=0))))return false;
    const linear=['line','arrow','pen','poly'].includes(element.type),shapes=['rect','diamond','ellipse','text','image','video'];
    if(!optional('pts',validPoints))return false;
    if(linear){if(!validPoints(element.pts))return false}
    else if(element.type==='text'){if(!finite(element.x)||!finite(element.y)||(own(element,'w')&&Math.abs(element.x+element.w)>COORD_LIMIT)||(own(element,'h')&&Math.abs(element.y+element.h)>COORD_LIMIT))return false}
    else if(!shapes.includes(element.type)||![element.x,element.y,element.w,element.h].every(finite)||element.w<0||element.h<0||Math.abs(element.x+element.w)>COORD_LIMIT||Math.abs(element.y+element.h)>COORD_LIMIT)return false;
    if(element.type==='text'&&(!Number.isFinite(element.size)||element.size<6||element.size>400))return false;
    if(element.type==='image'&&!((typeof element.src==='string'&&element.src.length>0)||(typeof element.giphyId==='string'&&element.giphyId.length>0)))return false;
    if(element.type==='video'&&!(typeof element.src==='string'&&element.src.length>0))return false;
    return true;
  }
  return Object.freeze({VERSION,COORD_LIMIT,POINT_LIMIT,MAX_COMMENTS,MAX_ELEMENT_ID_LENGTH,FONTS,validElement});
});
