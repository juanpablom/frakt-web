import React, { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet'
import { useParams, useHistory } from 'react-router-dom'

import AppLayout from '../../components/AppLayout'
import styles from './styles.module.scss'
import { URLS } from '../../constants'
import { useArts } from '../../contexts/artDetails'
import { PublicKey } from '@solana/web3.js'
import Preloader from '../../components/Preloader'
import ArtHeader from './components/ArtHeader'
import { getHeaderTitle, getArtInfoData } from './helpers'
import Table from '../../components/Table'
import ArtImage from '../../components/ArtImage'
import { useLazyArtImageSrc } from '../../hooks'

const ArtPage = () => {
  const { artAccountPubkey } = useParams<{ artAccountPubkey: string }>()
  const history = useHistory()
  const { arts, getArts, getArtOwner, artMetaByMintKey } = useArts()
  const [art, setArt] = useState({
    attributes: null,
    metadata: null,
    rarity: 0,
  })
  const { getSrc: getImageSrc, src: imageSrc, files } = useLazyArtImageSrc()
  const [ownerAddress, setOwnerAddress] = useState(null)
  const [, setLoadingOwnerAddress] = useState(false)
  const [tokenPubkey, setTokenPubkey] = useState(null)

  const loadOwnerAddress = async (art) => {
    setLoadingOwnerAddress(true)
    const ownerAddress: PublicKey = await getArtOwner(
      new PublicKey(art?.metadata.minted_token_pubkey)
    )
    setOwnerAddress(ownerAddress.toString())
    setLoadingOwnerAddress(false)
    const tokenPubkey = art?.metadata?.minted_token_pubkey
    setTokenPubkey(tokenPubkey.toString())
  }

  //TODO: understand WTF is this
  const loadArt = async () => {
    const data = arts.find(
      (art) => art.metadata.artAccountPubkey === artAccountPubkey
    )

    if (!data) {
      const arts = await getArts()
      const data = arts.find(
        (art) => art.metadata.artAccountPubkey === artAccountPubkey
      )
      loadOwnerAddress(data)
      getImageSrc(data)
      return setArt(data)
    }

    loadOwnerAddress(data)
    getImageSrc(data)
    setArt(data)
  }

  useEffect(() => {
    loadArt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (art.metadata) {
      getImageSrc(art)
    }
  }, [artMetaByMintKey, art.metadata])

  const onBackButtonHandler = () =>
    history.length <= 2 ? history.replace(URLS.ROOT) : history.goBack()

  return (
    <AppLayout
      CustomHeader={() => (
        <ArtHeader
          title={getHeaderTitle(art)}
          onBackButtonClick={onBackButtonHandler}
          imageFile={files[2]}
        />
      )}
      mainClassName={!imageSrc && styles.appLayoutMain}
    >
      <Helmet>
        <title>{`Art ${art?.metadata?.art_hash ? `#${art.metadata.hash}` : ''
          } | FRAKT: Generative Art NFT Collection on Solana`}</title>
      </Helmet>
      <div className={styles.artContainer}>
        {!imageSrc ? (
          <div className={styles.preloaderWrapper}>
            <Preloader size='lg' />
          </div>
        ) : (
          <>
            <ArtImage src={files[1] || imageSrc} preloaderSize='md' />
            {art && (
              <div className={styles.info}>
                <Table
                  data={getArtInfoData({
                    ownerAddress,
                    artData: art,
                    tokenPubkey,
                  })}
                  size='md'
                />
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  )
}

export default ArtPage
