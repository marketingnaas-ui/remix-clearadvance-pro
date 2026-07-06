const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const liffRenderBlock = `
  if (liffState === "loading") {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center space-y-3 animate-fade-in">
          <Loader2 className="w-8 h-8 animate-spin text-stone-500 mx-auto" />
          <p className="text-xs text-stone-500 font-bold">กำลังเข้าสู่ระบบผ่าน LINE...</p>
        </div>
      </div>
    );
  }

  if (liffState === "not_linked") {
    return (
      <LineAccountLinker 
        liffProfile={liffProfileContext} 
        onLinked={(emp) => {
          setCurrentEmployee(emp);
          setLiffState("linked");
        }} 
      />
    );
  }

  if (deepLinkResolved === "loading") {
`;

content = content.replace('  if (deepLinkResolved === "loading") {', liffRenderBlock);

fs.writeFileSync('src/App.tsx', content);
