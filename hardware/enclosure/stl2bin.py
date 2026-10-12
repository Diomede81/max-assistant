"""Convert ASCII STL (as written by OpenSCAD 2021) to binary STL: ~5x smaller, same geometry."""
import struct, sys

def convert(src, dst):
    tris, normal, verts = [], None, []
    with open(src) as f:
        for line in f:
            p = line.split()
            if not p:
                continue
            if p[0] == 'facet':
                normal = tuple(map(float, p[2:5]))
                verts = []
            elif p[0] == 'vertex':
                verts.append(tuple(map(float, p[1:4])))
            elif p[0] == 'endfacet':
                tris.append((normal, verts))
    with open(dst, 'wb') as o:
        o.write(b'Max box - binary STL'.ljust(80, b' '))
        o.write(struct.pack('<I', len(tris)))
        for n, v in tris:
            o.write(struct.pack('<12fH', *n, *v[0], *v[1], *v[2], 0))
    return len(tris)

if __name__ == '__main__':
    for path in sys.argv[1:]:
        tmp = path + '.bin'
        n = convert(path, tmp)
        import os
        os.replace(tmp, path)
        print(f'{path}: {n} triangles')
