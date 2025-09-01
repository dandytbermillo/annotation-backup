#!/bin/bash

# Apply Next.js 15 params typing fix
# This script applies the correct fix for Next.js 15 compatibility

echo "🔧 Applying Next.js 15 params typing fix..."
echo ""

# Apply the patch
if git apply claude_code_proposal/0009-fix-nextjs15-params-typing.patch; then
    echo "✅ Patch applied successfully!"
else
    echo "⚠️  Patch already applied or manual fix needed"
    echo "   Manually updating the file..."
    
    # Manual fix if patch fails
    sed -i.bak 's/{ params }: { params: { id: string } }/{ params }: { params: Promise<{ id: string }> }/' \
        app/api/postgres-offline/branches/[id]/route.ts
    
    sed -i.bak 's/const { id } = params/const { id } = await params/' \
        app/api/postgres-offline/branches/[id]/route.ts
        
    echo "✅ Manual fix applied!"
fi

echo ""
echo "📝 Summary:"
echo "- Fixed: app/api/postgres-offline/branches/[id]/route.ts"
echo "- This resolves Next.js 15 warnings about sync dynamic APIs"
echo ""
echo "⚠️  DO NOT apply patch 0008 - it would break Next.js 15!"
echo ""
echo "To verify the fix works:"
echo "1. Restart your dev server: npm run dev"
echo "2. Check for warnings in the terminal"
echo "3. Test the endpoint: curl http://localhost:3000/api/postgres-offline/branches/test-id"